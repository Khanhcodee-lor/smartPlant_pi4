#!/usr/bin/env python3
"""Bridge an ESP32 BLE Mesh provisioner to Smart Plant over USB serial."""
import argparse
import fcntl
import glob
import json
import os
from pathlib import Path
import select
import signal
import socket
import socketserver
import sqlite3
import termios
import threading
import time

ROOT = Path(__file__).resolve().parent.parent


def load_server_env():
    """Load plain KEY=VALUE settings shared with the Node server."""
    env_path = ROOT / 'server/.env'
    if not env_path.is_file():
        return
    for line in env_path.read_text(encoding='utf-8').splitlines():
        line = line.strip()
        if not line or line.startswith('#') or '=' not in line:
            continue
        key, value = line.split('=', 1)
        value = value.strip().strip('"').strip("'")
        os.environ.setdefault(key.strip(), value)


load_server_env()

SOCKET_PATH = os.environ.get('MESH_SOCKET_PATH', str(ROOT / 'ble_mesh.sock'))
DB_PATH = os.environ.get('DB_PATH', str(ROOT / 'server/db/smart_plant.db'))
SERIAL_PORT = os.environ.get('MESH_SERIAL_PORT')
BAUD_RATE = int(os.environ.get('MESH_SERIAL_BAUD', '115200'))
DEVICE_UUID_PREFIX = b'SPM1'.hex()
REQUIRED_FLAGS = ('provisioned', 'appkey', 'bind', 'publication')
MAX_LINE = 4096
HANDSHAKE_TIMEOUT = 20
STATUS_INTERVAL = 2
FIREBASE_DATABASE_URL = os.environ.get(
    'FIREBASE_DATABASE_URL',
    'https://pi4-iot-1b7bb-default-rtdb.asia-southeast1.firebasedatabase.app',
)
FIREBASE_CREDENTIALS = os.environ.get(
    'GOOGLE_APPLICATION_CREDENTIALS', str(ROOT / 'ai_engine/config/pi4-iot.json')
)


class FirebaseRTDB:
    """Optional Firebase mirror for live BLE sensor readings."""

    def __init__(self):
        self.database = None
        self.status = 'disabled'
        self.error = None
        self.write_counts = {}
        try:
            self.max_history = int(os.environ.get('FIREBASE_MAX_HISTORY', '100'))
        except (ValueError, TypeError):
            self.max_history = 100

        if os.environ.get('FIREBASE_ENABLED', '').lower() not in ('1', 'true', 'yes'):
            return

        try:
            import firebase_admin
            from firebase_admin import credentials, db

            if not Path(FIREBASE_CREDENTIALS).is_file():
                raise FileNotFoundError(f'Firebase service account not found: {FIREBASE_CREDENTIALS}')

            try:
                app = firebase_admin.get_app('smart-plant-rtdb')
            except ValueError:
                app = firebase_admin.initialize_app(
                    credentials.Certificate(FIREBASE_CREDENTIALS),
                    {'databaseURL': FIREBASE_DATABASE_URL},
                    name='smart-plant-rtdb',
                )
            self.app = app
            self.database = db
            self.root = db.reference('/', app=app)
            self.status = 'ready'
        except Exception as error:
            self.error = str(error)
            self.status = 'error'

    def _prune_history(self, firebase_key, max_entries=100):
        """Giữ tối đa max_entries bản ghi mới nhất, xóa các bản ghi cũ hơn."""
        if not self.database or not getattr(self, 'root', None) or max_entries <= 0:
            return
        try:
            history_ref = self.root.child(f'{firebase_key}/history')
            data = history_ref.order_by_key().get()
            if data and isinstance(data, dict) and len(data) > max_entries:
                excess = len(data) - max_entries
                sorted_keys = sorted(data.keys())
                keys_to_delete = sorted_keys[:excess]
                updates = {f'{firebase_key}/history/{k}': None for k in keys_to_delete}
                self.root.update(updates)
        except Exception:
            pass

    def write_sensor(self, mesh_address, zone_id, values, node_name=None, zone_name=None):
        if self.database is None or not getattr(self, 'root', None):
            return False
        try:
            import re
            raw_name = str(node_name or '').strip()
            clean_name = re.sub(r'[\.\$#\[\]/]', '', raw_name)
            if not clean_name:
                clean_name = f"node_{mesh_address.lower().replace('0x', '')}"

            # Chuẩn hóa tên node: ví dụ "Node 1" -> "node1", "Node-1" -> "node1", "node 2" -> "node2"
            match = re.match(r'^(node)[\s\-_]*(\d+)$', clean_name, re.IGNORECASE)
            if match:
                firebase_key = f"{match.group(1).lower()}{match.group(2)}"
            else:
                firebase_key = re.sub(r'\s+', '_', clean_name).lower()

            now_str = time.strftime('%Y-%m-%d %H:%M:%S')
            sensor_data = {
                **values,
                'mesh_address': mesh_address,
                'node_name': raw_name or firebase_key,
                'zone_id': zone_id,
                'zone_name': zone_name or '',
                'updated_at': now_str,
                'timestamp': {'.sv': 'timestamp'},
            }

            history_reading = {
                **values,
                'timestamp': {'.sv': 'timestamp'},
                'created_at': now_str,
            }

            history_key = self.root.child(f'{firebase_key}/history').push().key
            self.root.update({
                f'{firebase_key}/sensor': sensor_data,
                f'{firebase_key}/history/{history_key}': history_reading,
            })

            # Tự động duy trì tối đa N bản ghi gần nhất (Rolling Window) trong background thread
            count = self.write_counts.get(firebase_key, 0) + 1
            self.write_counts[firebase_key] = count
            if count % 5 == 0 or count <= 1:
                threading.Thread(
                    target=self._prune_history,
                    args=(firebase_key, self.max_history),
                    daemon=True
                ).start()

            self.status = 'connected'
            self.error = None
            return True
        except Exception as error:
            self.status = 'error'
            self.error = str(error)
            return False


def database():
    conn = sqlite3.connect(DB_PATH, timeout=10)
    conn.row_factory = sqlite3.Row
    conn.execute('PRAGMA foreign_keys=ON')
    return conn


def normalize_uuid(value):
    ident = str(value or '').replace('-', '').replace(':', '').lower()
    if len(ident) != 32 or any(char not in '0123456789abcdef' for char in ident):
        raise ValueError('UUID must contain 32 hexadecimal characters')
    if not ident.startswith(DEVICE_UUID_PREFIX):
        raise ValueError('ESP32 UUID must start with SPM1')
    return ident


def normalize_address(value):
    address = int(value, 0) if isinstance(value, str) else int(value)
    if not 1 <= address <= 0x7fff:
        raise ValueError('Invalid mesh unicast address')
    return address


def serial_candidates():
    if SERIAL_PORT:
        return [SERIAL_PORT]
    paths = glob.glob('/dev/serial/by-id/*')
    paths += glob.glob('/dev/ttyACM*') + glob.glob('/dev/ttyUSB*')
    unique = {}
    for path in paths:
        unique.setdefault(os.path.realpath(path), path)
    return list(unique.values())


def configure_serial(fd):
    if BAUD_RATE != 115200:
        raise ValueError('Only 115200 baud is supported')
    attrs = termios.tcgetattr(fd)
    attrs[0] = 0
    attrs[1] = 0
    attrs[2] = termios.CS8 | termios.CLOCAL | termios.CREAD
    attrs[3] = 0
    attrs[4] = termios.B115200
    attrs[5] = termios.B115200
    attrs[6][termios.VMIN] = 0
    attrs[6][termios.VTIME] = 10
    termios.tcsetattr(fd, termios.TCSANOW, attrs)
    termios.tcflush(fd, termios.TCIOFLUSH)


class Gateway:
    def __init__(self):
        with database() as conn:
            conn.execute("CREATE TABLE IF NOT EXISTS mesh_removals (uuid TEXT PRIMARY KEY, state TEXT NOT NULL)")
        self.lock = threading.RLock()
        self.stop_event = threading.Event()
        self.fd = None
        self.port = None
        self.last_seen = 0
        self.connected_at = 0
        self.last_status_request = 0
        self.candidate_index = 0
        self.synchronized = False
        self.discovered = {}
        self.nodes = {}
        self.status = {
            'state': 'starting', 'ready': False, 'transport': 'usb_serial',
            'baud_rate': BAUD_RATE, 'devices': [], 'nodes': [],
        }
        self.firebase = FirebaseRTDB()
        self.status['firebase_status'] = self.firebase.status
        if self.firebase.error:
            self.status['firebase_error'] = self.firebase.error

    def snapshot(self):
        with self.lock:
            result = dict(self.status)
            result['ready'] = bool(self.fd is not None and self.status.get('ready'))
            result['devices'] = list(self.discovered.values())
            result['nodes'] = list(self.nodes.values())
            result['serial_port'] = self.port
            result['last_gateway_seen'] = self.last_seen or None
            return result

    def report(self, state=None, **fields):
        with self.lock:
            if state:
                self.status['state'] = state
                if not state.endswith('failed') and state != 'error':
                    self.status.pop('error', None)
            self.status.update(fields)
            message = self.snapshot()
        print(json.dumps(message, ensure_ascii=True), flush=True)

    def connect(self):
        ports = serial_candidates()
        if not ports:
            self.report('disconnected', ready=False,
                        error='Không thấy cổng USB serial trên máy chạy bridge. Kiểm tra cáp data và cổng USB của Pi.')
            return False
        start = self.candidate_index % len(ports)
        for offset in range(len(ports)):
            index = (start + offset) % len(ports)
            port = ports[index]
            fd = None
            try:
                fd = os.open(port, os.O_RDWR | os.O_NOCTTY | os.O_NONBLOCK)
                fcntl.flock(fd, fcntl.LOCK_EX | fcntl.LOCK_NB)
                configure_serial(fd)
                with self.lock:
                    self.fd = fd
                    self.port = os.path.realpath(port)
                    self.status.update(state='connecting', ready=False)
                    self.status.pop('error', None)
                    self.connected_at = time.monotonic()
                    self.last_status_request = self.connected_at
                    self.synchronized = False
                    self.candidate_index = index + 1
                self.write({'action': 'status'})
                self.report()
                return True
            except (OSError, ValueError) as error:
                if fd is not None:
                    with self.lock:
                        if self.fd == fd:
                            self.fd = None
                            self.port = None
                    os.close(fd)
                self.report('disconnected', ready=False, error=f'{port}: {error}')
        return False

    def disconnect(self, error=None):
        with self.lock:
            fd, self.fd = self.fd, None
            self.port = None
            self.discovered.clear()
            self.synchronized = False
            self.status.update(state='disconnected', ready=False)
            if error:
                self.status['error'] = str(error)
        if fd is not None:
            try:
                os.close(fd)
            except OSError:
                pass
        self.report()

    def write(self, payload):
        data = (json.dumps(payload, separators=(',', ':')) + '\n').encode()
        with self.lock:
            if self.fd is None:
                raise ValueError('ESP32 gateway is not connected by USB')
            _, writable, _ = select.select([], [self.fd], [], 2.0)
            if not writable:
                raise OSError('UART TX buffer not writable')
            written = os.write(self.fd, data)
            if written != len(data):
                raise OSError('Incomplete serial write')

    def run(self):
        buffer = b''
        while not self.stop_event.is_set():
            if self.fd is None:
                if not self.connect():
                    self.stop_event.wait(2)
                buffer = b''
                continue
            try:
                with self.lock:
                    fd = self.fd
                if fd is None:
                    continue
                now = time.monotonic()
                if not self.status.get('ready') and not self.synchronized:
                    if now - self.connected_at >= HANDSHAKE_TIMEOUT:
                        raise OSError('ESP32 không trả gateway ready qua USB; kiểm tra firmware gateway, baud 115200 và đóng Serial Monitor')
                    if now - self.last_status_request >= STATUS_INTERVAL:
                        self.write({'action': 'status'})
                        self.last_status_request = now
                readable, _, _ = select.select([fd], [], [], 1)
                if not readable:
                    continue
                chunk = os.read(fd, 1024)
                if not chunk:
                    raise OSError('USB serial device closed')
                buffer += chunk
                if len(buffer) > MAX_LINE * 2:
                    buffer = b''
                    self.report('error', error='Serial message exceeded size limit')
                    continue
                while b'\n' in buffer:
                    line, buffer = buffer.split(b'\n', 1)
                    self.handle_line(line.strip())
            except BlockingIOError:
                continue
            except OSError as error:
                if self.stop_event.is_set():
                    break
                self.disconnect(error)

    def handle_line(self, line):
        if not line:
            return
        try:
            if not (line.startswith(b'{') and line.endswith(b'}')):
                return  # Ignore ROM boot text or fragmented lines
            event = json.loads(line.decode('utf-8'))
            if not isinstance(event, dict):
                raise ValueError('Expected a JSON object')
            self.handle_event(event)
        except (UnicodeDecodeError, json.JSONDecodeError, ValueError, KeyError,
                TypeError, sqlite3.Error) as error:
            self.report('error', error=f'Invalid ESP32 message: {error}')

    def handle_event(self, event):
        kind = event.get('event')
        with self.lock:
            self.last_seen = time.time()
        if kind in ('gateway', 'status'):
            ready = bool(event.get('ready'))
            self.report(event.get('state') or ('attached' if ready else 'starting'),
                        ready=ready, firmware=event.get('firmware'),
                        gateway_address=event.get('address', '0x0001'))
            if ready and not self.synchronized and self.fd is not None:
                self.synchronized = True
                self.write({'action': 'status'})  # Replay persisted nodes after boot/reconnect.
                if self.status.get('state') in ('attached', 'remove_failed'):
                    with database() as conn:
                        pending = conn.execute("SELECT uuid FROM mesh_removals WHERE state='pending' LIMIT 1").fetchone()
                    if pending:
                        self.command({'action': 'remove', 'uuid': pending['uuid']})
        elif kind == 'scan_result':
            ident = normalize_uuid(event.get('uuid'))
            device = {'uuid': ident, 'rssi': int(event.get('rssi', 0)), 'seen_at': time.time()}
            with self.lock:
                self.discovered[ident] = device
            self.report(None if self.status.get('state') in ('provisioning', 'configuring', 'removing') else 'scanning')
        elif kind == 'state':
            state = str(event.get('state') or 'error')
            fields = {'ready': bool(event.get('ready', self.status.get('ready')))}
            if event.get('error'):
                fields['error'] = str(event['error'])
            if state == 'remove_failed':
                with database() as conn:
                    conn.execute("UPDATE mesh_removals SET state='failed' WHERE state='pending'")
            self.report(state, **fields)
        elif kind == 'node_removed':
            self.finish_removal(normalize_uuid(event.get('uuid')))
        elif kind == 'node':
            self.handle_node(event)
        elif kind == 'sensor':
            self.handle_sensor(event)
        elif kind == 'error':
            # A rejected command must not erase the operation still in progress.
            self.report(error=str(event.get('message') or 'ESP32 gateway error'))
            if self.fd is not None:
                self.write({'action': 'status'})

    def handle_node(self, event):
        ident = normalize_uuid(event.get('uuid'))
        with database() as conn:
            removed = conn.execute("SELECT state FROM mesh_removals WHERE uuid=?", (ident,)).fetchone()
        if removed and removed['state'] == 'confirmed':
            return
        address = normalize_address(event.get('address'))
        flags = {name: event.get(name) is True for name in REQUIRED_FLAGS}
        configured = all(flags.values())
        node = {'uuid': ident, 'mesh_address': f'0x{address:04x}',
                **flags, 'configured': configured}
        with self.lock:
            self.nodes[ident] = node
            self.discovered.pop(ident, None)
        self.save_node(node)
        self.report(**node)  # Node snapshots must not overwrite the gateway's operation state.

    def save_node(self, node):
        with database() as conn:
            row = conn.execute('SELECT id,zone_id,status,mesh_address FROM ble_nodes WHERE uuid=?', (node['uuid'],)).fetchone()
            status = 'configured' if node['configured'] else 'provisioned'
            if row and row['status'] == 'active' and node['configured']:
                status = 'active'
            zone_id = row['zone_id'] if row else None
            # A provisioning snapshot is not a successful Join.
            if node['configured'] and zone_id is None:
                zone_id = conn.execute(
                    'INSERT INTO zones(name,description,mesh_address) VALUES(?,?,?)',
                    (f"Khu {node['mesh_address'][2:]}", f"ESP32 {node['uuid']}", node['mesh_address'])
                ).lastrowid
            if row:
                conn.execute('UPDATE ble_nodes SET mesh_address=?,status=?,zone_id=? WHERE uuid=?',
                             (node['mesh_address'], status, zone_id, node['uuid']))
            else:
                conn.execute('INSERT INTO ble_nodes(uuid,mesh_address,name,zone_id,status) VALUES(?,?,?,?,?)',
                             (node['uuid'], node['mesh_address'], f"Node-{node['mesh_address'][2:]}", zone_id, status))
            if zone_id is not None:
                conn.execute('UPDATE zones SET mesh_address=? WHERE id=?', (node['mesh_address'], zone_id))

    def finish_removal(self, ident):
        with self.lock, database() as conn:
            row = conn.execute('SELECT zone_id FROM ble_nodes WHERE uuid=?', (ident,)).fetchone()
            conn.execute("INSERT OR REPLACE INTO mesh_removals VALUES (?, 'confirmed')", (ident,))
            conn.execute('DELETE FROM ble_nodes WHERE uuid=?', (ident,))
            if row and row['zone_id'] is not None:
                zone_id = row['zone_id']
                if not conn.execute('SELECT 1 FROM ble_nodes WHERE zone_id=?', (zone_id,)).fetchone():
                    conn.execute('DELETE FROM sensor_data WHERE zone_id=?', (zone_id,))
                    conn.execute('DELETE FROM pest_detections WHERE zone_id=?', (zone_id,))
                    conn.execute('DELETE FROM zones WHERE id=?', (zone_id,))
            self.nodes.pop(ident, None)
            self.discovered.pop(ident, None)
            for field in ('error', 'uuid', 'mesh_address', 'configured', 'sensor_address', 'last_sensor', *REQUIRED_FLAGS):
                self.status.pop(field, None)
            self.report('attached', removed_uuid=ident)

    def handle_sensor(self, event):
        address = normalize_address(event.get('address'))
        values = {
            'temperature': float(event['temperature']),
            'humidity': float(event['humidity']),
            'light': int(event['light']),
            'soil_moisture': float(event['soil_moisture']),
        }
        if not -50 <= values['temperature'] <= 100:
            raise ValueError('Temperature is outside accepted range')
        if not (0 <= values['humidity'] <= 100 and 0 <= values['soil_moisture'] <= 100):
            raise ValueError('Humidity is outside accepted range')
        if not 0 <= values['light'] <= 65535:
            raise ValueError('Light is outside accepted range')
        mesh_address = f'0x{address:04x}'
        zone_id = None
        node_name = None
        zone_name = None
        with database() as conn:
            node = conn.execute(
                'SELECT bn.id, bn.name, bn.zone_id, bn.status, z.name as zone_name '
                'FROM ble_nodes bn '
                'LEFT JOIN zones z ON bn.zone_id = z.id '
                'WHERE bn.mesh_address=?',
                (mesh_address,)
            ).fetchone()
            if node is None or node['status'] not in ('configured', 'active'):
                raise ValueError(f'Unknown or unconfigured sensor node {mesh_address}')
            zone_id = node['zone_id']
            node_name = node['name']
            zone_name = node['zone_name']
            conn.execute(
                'INSERT INTO sensor_data(temperature,humidity,light,soil_moisture,zone_id) VALUES(?,?,?,?,?)',
                (*values.values(), zone_id)
            )
            conn.execute('UPDATE ble_nodes SET status=?,last_seen=CURRENT_TIMESTAMP WHERE mesh_address=?',
                         ('active', mesh_address))
        firebase_ok = self.firebase.write_sensor(
            mesh_address, zone_id, values, node_name=node_name, zone_name=zone_name
        )
        fields = {
            'sensor_address': mesh_address,
            'node_name': node_name,
            'last_sensor': values,
            'firebase_status': self.firebase.status,
        }
        if self.firebase.error:
            fields['firebase_error'] = self.firebase.error
        else:
            self.status.pop('firebase_error', None)
        if not firebase_ok and self.firebase.status == 'ready':
            fields['firebase_status'] = 'error'
        self.report(**fields)

    def command(self, request):
        action = request.get('action')
        if action == 'status':
            return {'success': True, 'data': self.snapshot()}
        command = {'action': action}
        if action in ('provision', 'configure', 'remove'):
            command['uuid'] = normalize_uuid(request.get('uuid'))
        elif action != 'scan':
            raise ValueError('Unknown action')
        with self.lock:
            if self.fd is None or not self.status.get('ready'):
                raise ValueError('ESP32 Mesh Gateway is not ready on USB')
            if self.status.get('state') in ('provisioning', 'configuring', 'removing'):
                raise ValueError('Gateway đang thêm/cấu hình node. Chờ thao tác hiện tại hoàn tất.')
            if action == 'remove':
                if (self.status.get('firmware') or '1.0.0') < '1.1.0':
                    raise ValueError('Cần firmware gateway 1.1.0 để xóa node khỏi mạng')
                with database() as conn:
                    conn.execute("INSERT OR REPLACE INTO mesh_removals VALUES (?, 'pending')", (command['uuid'],))
            if action == 'provision':
                with database() as conn:
                    conn.execute('DELETE FROM mesh_removals WHERE uuid=?', (command['uuid'],))
            self.write(command)
            if action == 'scan':
                self.discovered.clear()
            self.report({'scan': 'scanning', 'provision': 'provisioning',
                         'configure': 'configuring', 'remove': 'removing'}[action])
        return {'success': True, 'message': 'Command sent; awaiting gateway result'}

    def stop(self):
        self.stop_event.set()
        self.disconnect()


class CommandHandler(socketserver.StreamRequestHandler):
    def handle(self):
        self.connection.settimeout(5)
        try:
            line = self.rfile.readline(MAX_LINE + 1)
            if len(line) > MAX_LINE or not line.endswith(b'\n'):
                raise ValueError('Invalid command')
            request = json.loads(line)
            if not isinstance(request, dict):
                raise ValueError('Expected JSON object')
            result = self.server.gateway.command(request)
        except (ValueError, OSError, json.JSONDecodeError) as error:
            result = {'success': False, 'error': str(error)}
        self.wfile.write(json.dumps(result).encode() + b'\n')


class CommandServer(socketserver.ThreadingUnixStreamServer):
    daemon_threads = True


def send_cli(action, ident):
    with socket.socket(socket.AF_UNIX, socket.SOCK_STREAM) as client:
        client.settimeout(5)
        client.connect(SOCKET_PATH)
        client.sendall(json.dumps({'action': action, 'uuid': ident}).encode() + b'\n')
        response = json.loads(client.makefile('rb').readline())
    print(json.dumps(response, indent=2))
    return 0 if response.get('success') else 1


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('action', nargs='?', default='run',
                        choices=['run', 'status', 'scan', 'provision', 'configure'])
    parser.add_argument('uuid', nargs='?')
    args = parser.parse_args()
    if args.action != 'run':
        return send_cli(args.action, args.uuid)
    with open(SOCKET_PATH + '.lock', 'w') as lock:
        fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
        with database() as conn:
            conn.execute('SELECT uuid FROM ble_nodes LIMIT 1')
        gateway = Gateway()
        if os.path.exists(SOCKET_PATH):
            os.unlink(SOCKET_PATH)
        server = CommandServer(SOCKET_PATH, CommandHandler)
        server.gateway = gateway
        os.chmod(SOCKET_PATH, 0o660)
        threading.Thread(target=server.serve_forever, daemon=True).start()
        threading.Thread(target=gateway.run, daemon=True).start()
        stopped = threading.Event()
        signal.signal(signal.SIGTERM, lambda *_: stopped.set())
        signal.signal(signal.SIGINT, lambda *_: stopped.set())
        try:
            while not stopped.wait(1):
                pass
        finally:
            gateway.stop()
            server.shutdown()
            server.server_close()
            if os.path.exists(SOCKET_PATH):
                os.unlink(SOCKET_PATH)
    return 0


if __name__ == '__main__':
    try:
        raise SystemExit(main())
    except (OSError, ValueError, RuntimeError, sqlite3.Error) as error:
        print(f'BLE Mesh gateway failed: {error}', flush=True)
        raise SystemExit(1)
