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
SOCKET_PATH = os.environ.get('MESH_SOCKET_PATH', str(ROOT / 'ble_mesh.sock'))
DB_PATH = os.environ.get('DB_PATH', str(ROOT / 'server/db/smart_plant.db'))
SERIAL_PORT = os.environ.get('MESH_SERIAL_PORT')
BAUD_RATE = int(os.environ.get('MESH_SERIAL_BAUD', '115200'))
DEVICE_UUID_PREFIX = b'SPM1'.hex()
REQUIRED_FLAGS = ('provisioned', 'appkey', 'bind', 'publication')
MAX_LINE = 4096


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
    return list(dict.fromkeys(paths))


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
        self.lock = threading.RLock()
        self.stop_event = threading.Event()
        self.fd = None
        self.port = None
        self.last_seen = 0
        self.discovered = {}
        self.nodes = {}
        self.status = {
            'state': 'starting', 'ready': False, 'transport': 'usb_serial',
            'baud_rate': BAUD_RATE, 'devices': [], 'nodes': [],
        }

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
        for port in serial_candidates():
            try:
                fd = os.open(port, os.O_RDWR | os.O_NOCTTY | os.O_NONBLOCK)
                configure_serial(fd)
                with self.lock:
                    self.fd = fd
                    self.port = os.path.realpath(port)
                    self.status.update(state='connecting', ready=False)
                self.write({'action': 'status'})
                self.report()
                return True
            except (OSError, ValueError) as error:
                self.report('disconnected', ready=False, error=f'{port}: {error}')
        return False

    def disconnect(self, error=None):
        with self.lock:
            fd, self.fd = self.fd, None
            self.port = None
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
            except OSError as error:
                if self.stop_event.is_set():
                    break
                self.disconnect(error)

    def handle_line(self, line):
        if not line:
            return
        try:
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
        elif kind == 'scan_result':
            ident = normalize_uuid(event.get('uuid'))
            device = {'uuid': ident, 'rssi': int(event.get('rssi', 0)), 'seen_at': time.time()}
            with self.lock:
                self.discovered[ident] = device
            self.report('scanning')
        elif kind == 'state':
            state = str(event.get('state') or 'error')
            fields = {'ready': bool(event.get('ready', self.status.get('ready')))}
            if event.get('error'):
                fields['error'] = str(event['error'])
            self.report(state, **fields)
        elif kind == 'node':
            self.handle_node(event)
        elif kind == 'sensor':
            self.handle_sensor(event)
        elif kind == 'error':
            self.report('error', error=str(event.get('message') or 'ESP32 gateway error'))

    def handle_node(self, event):
        ident = normalize_uuid(event.get('uuid'))
        address = normalize_address(event.get('address'))
        flags = {name: bool(event.get(name)) for name in REQUIRED_FLAGS}
        configured = all(flags.values())
        node = {'uuid': ident, 'mesh_address': f'0x{address:04x}',
                **flags, 'configured': configured}
        with self.lock:
            self.nodes[ident] = node
            self.discovered.pop(ident, None)
        self.save_node(node)
        self.report('node_configured' if configured else 'configuring', **node)

    def save_node(self, node):
        with database() as conn:
            row = conn.execute('SELECT id FROM ble_nodes WHERE uuid=?', (node['uuid'],)).fetchone()
            status = 'configured' if node['configured'] else 'provisioned'
            if row:
                conn.execute('UPDATE ble_nodes SET mesh_address=?,status=? WHERE uuid=?',
                             (node['mesh_address'], status, node['uuid']))
                return
            zone_name = f"Khu {node['mesh_address'][2:]}"
            zone = conn.execute('SELECT id FROM zones WHERE name=?', (zone_name,)).fetchone()
            if zone:
                zone_id = zone['id']
                conn.execute('UPDATE zones SET mesh_address=? WHERE id=?',
                             (node['mesh_address'], zone_id))
            else:
                zone_id = conn.execute(
                    'INSERT INTO zones(name,description,mesh_address) VALUES(?,?,?)',
                    (zone_name, f"ESP32 {node['uuid']}", node['mesh_address'])
                ).lastrowid
            conn.execute(
                'INSERT INTO ble_nodes(uuid,mesh_address,name,zone_id,status) VALUES(?,?,?,?,?)',
                (node['uuid'], node['mesh_address'], f"Node-{node['mesh_address'][2:]}", zone_id, status)
            )

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
        with database() as conn:
            node = conn.execute('SELECT zone_id,status FROM ble_nodes WHERE mesh_address=?',
                                (mesh_address,)).fetchone()
            if node is None or node['status'] not in ('configured', 'active'):
                raise ValueError(f'Unknown or unconfigured sensor node {mesh_address}')
            conn.execute(
                'INSERT INTO sensor_data(temperature,humidity,light,soil_moisture,zone_id) VALUES(?,?,?,?,?)',
                (*values.values(), node['zone_id'])
            )
            conn.execute('UPDATE ble_nodes SET status=?,last_seen=CURRENT_TIMESTAMP WHERE mesh_address=?',
                         ('active', mesh_address))
        self.report(sensor_address=mesh_address, last_sensor=values)

    def command(self, request):
        action = request.get('action')
        if action == 'status':
            return {'success': True, 'data': self.snapshot()}
        with self.lock:
            ready = bool(self.fd is not None and self.status.get('ready'))
        if not ready:
            raise ValueError('ESP32 Mesh Gateway is not ready on USB')
        command = {'action': action}
        if action == 'scan':
            with self.lock:
                self.discovered.clear()
        elif action in ('provision', 'configure'):
            command['uuid'] = normalize_uuid(request.get('uuid'))
        else:
            raise ValueError('Unknown action')
        self.write(command)
        return {'success': True, 'message': 'Command sent to ESP32 gateway'}

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
