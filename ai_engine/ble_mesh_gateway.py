#!/usr/bin/env python3
"""BlueZ >= 5.66 BLE Mesh provisioner. See BLE_MESH.md for Pi/ESP setup."""
import argparse
import fcntl
import json
import os
from pathlib import Path
import signal
import socket
import socketserver
import sqlite3
import struct
import threading
import time
import uuid

import dbus
import dbus.service
import dbus.mainloop.glib
from gi.repository import GLib

from ble_mesh_protocol import (APP_INDEX, COMPANY_ID, MODEL_ID, NET_INDEX,
                               PI_ADDRESS, bind_request, expected_status,
                               publication_request, sensor_message, vendor_elements)

ROOT = Path(__file__).resolve().parent.parent
STATE_DIR = Path(os.environ.get('MESH_STATE_DIR', ROOT / 'ai_engine' / 'mesh_state'))
SOCKET_PATH = os.environ.get('MESH_SOCKET_PATH', str(ROOT / 'ble_mesh.sock'))
STATUS_FILE = ROOT / 'ble_mesh_status.json'
DB_PATH = os.environ.get('DB_PATH', str(ROOT / 'server/db/smart_plant.db'))
DEVICE_UUID_PREFIX = b'SPM1'.hex()
APP_PATH = '/smart_plant/mesh'
ELEMENT_PATH = APP_PATH + '/element0'
SERVICE = 'org.bluez.mesh'
NETWORK = SERVICE + '.Network1'
NODE = SERVICE + '.Node1'
MANAGEMENT = SERVICE + '.Management1'
APPLICATION = SERVICE + '.Application1'
PROVISIONER = SERVICE + '.Provisioner1'
AGENT = SERVICE + '.ProvisionAgent1'
ELEMENT = SERVICE + '.Element1'
OM = 'org.freedesktop.DBus.ObjectManager'
PROPERTIES = 'org.freedesktop.DBus.Properties'


def atomic_json(path, value, mode=0o600):
    path = Path(path)
    temporary = path.with_name(path.name + '.tmp')
    fd = os.open(temporary, os.O_WRONLY | os.O_CREAT | os.O_TRUNC, mode)
    with os.fdopen(fd, 'w') as handle:
        json.dump(value, handle, indent=2)
        handle.flush()
        os.fsync(handle.fileno())
    os.replace(temporary, path)
    directory = os.open(path.parent, os.O_RDONLY | os.O_DIRECTORY)
    try:
        os.fsync(directory)
    finally:
        os.close(directory)


def database():
    conn = sqlite3.connect(DB_PATH, timeout=10)
    conn.row_factory = sqlite3.Row
    conn.execute('PRAGMA foreign_keys=ON')
    return conn


class Gateway(dbus.service.Object):
    def __init__(self, bus):
        super().__init__(bus, APP_PATH)
        self.bus = bus
        self.network = dbus.Interface(bus.get_object(SERVICE, '/org/bluez/mesh'), NETWORK)
        self.node = self.manager = None
        self.ready = False
        self.pending = None
        self.provisioning = None
        self.timer = None
        self.scan_timer = None
        self.discovered = {}
        self.status = {'state': 'starting'}
        self.state_path = STATE_DIR / 'network.json'
        if self.state_path.exists():
            self.state = json.loads(self.state_path.read_text())
        else:
            # Import the old attachment token, but never guess previously allocated ranges.
            legacy = ROOT / 'ai_engine/mesh_token.dat'
            with database() as conn:
                existing = conn.execute('SELECT COUNT(*) FROM ble_nodes').fetchone()[0]
            if existing or legacy.exists():
                raise RuntimeError('Legacy mesh state found. See BLE_MESH.md migration; do not reset address allocation blindly.')
            self.state = {'uuid': uuid.uuid4().hex, 'next_address': 2, 'nodes': {}}
            self.persist()
        self.element = Element(bus, self)
        self.agent = ProvisionAgent(bus)

    def persist(self):
        atomic_json(self.state_path, self.state)

    def node_status(self):
        nodes = []
        for ident, record in self.state.get('nodes', {}).items():
            nodes.append({
                'uuid': ident,
                'mesh_address': hex(record['address']),
                'count': record['count'],
                'provisioned': bool(record.get('provisioned')),
                'appkey': bool(record.get('appkey')),
                'bind': bool(record.get('bind')),
                'publication': bool(record.get('publication')),
                'configured': bool(record.get('configured')),
            })
        return nodes

    def node_records_for_address(self, address):
        return [record for record in self.state['nodes'].values() if record['address'] == address]

    def set_node_flags(self, address, **flags):
        records = self.node_records_for_address(address)
        for record in records:
            record.update(flags)
        if records:
            self.persist()
        return records

    def report(self, state=None, **fields):
        if state:
            self.status['state'] = state
            self.status.pop('error', None)
        self.status.update(fields)
        self.status.update(timestamp=time.time(), ready=self.ready,
                           devices=list(self.discovered.values()),
                           nodes=self.node_status())
        atomic_json(STATUS_FILE, self.status, 0o644)
        print(json.dumps(self.status), flush=True)

    @dbus.service.method(OM, out_signature='a{oa{sa{sv}}}')
    def GetManagedObjects(self):
        options = dbus.Dictionary({}, signature='sv')
        return {
            APP_PATH: {APPLICATION: {'CompanyID': dbus.UInt16(COMPANY_ID),
                                    'ProductID': dbus.UInt16(1), 'VersionID': dbus.UInt16(1)},
                       PROVISIONER: {}},
            ELEMENT_PATH: {ELEMENT: {
                'Index': dbus.Byte(0),
                'Models': dbus.Array([(dbus.UInt16(0x0001), options)], signature='(qa{sv})'),
                'VendorModels': dbus.Array([(dbus.UInt16(COMPANY_ID), dbus.UInt16(MODEL_ID), options)], signature='(qqa{sv})')}},
            APP_PATH + '/agent': {AGENT: {'Capabilities': dbus.Array([], signature='s')}}}

    def start(self):
        self.report('starting')
        if 'token' in self.state:
            self.attach()
        else:
            self.network.CreateNetwork(APP_PATH, dbus.ByteArray(bytes.fromhex(self.state['uuid'])),
                                       reply_handler=lambda: None, error_handler=self.fatal)

    @dbus.service.method(APPLICATION, in_signature='t', out_signature='')
    def JoinComplete(self, token):
        self.state['token'] = int(token)
        self.persist()
        GLib.idle_add(self.attach)

    @dbus.service.method(APPLICATION, in_signature='s', out_signature='')
    def JoinFailed(self, reason):
        self.fatal(reason)

    def attach(self):
        self.network.Attach(APP_PATH, dbus.UInt64(self.state['token']),
                            reply_handler=self.attached, error_handler=self.fatal)
        return False

    def attached(self, path, configuration):
        obj = self.bus.get_object(SERVICE, path)
        self.node = dbus.Interface(obj, NODE)
        self.manager = dbus.Interface(obj, MANAGEMENT)
        self.manager.CreateAppKey(dbus.UInt16(NET_INDEX), dbus.UInt16(APP_INDEX),
                                  reply_handler=self.configure_local, error_handler=self.key_error)

    def key_error(self, error):
        if error.get_dbus_name() == SERVICE + '.Error.AlreadyExists':
            self.configure_local()
        else:
            self.fatal(error)

    def configure_local(self):
        self.configure(PI_ADDRESS, 1)

    def fatal(self, error):
        self.ready = False
        self.report('error', error=str(error))

    @dbus.service.method(PROVISIONER, in_signature='naya{sv}', out_signature='')
    def ScanResult(self, rssi, data, options):
        raw = bytes(data)
        if len(raw) < 16:
            return
        ident = raw[:16].hex()
        if not ident.startswith(DEVICE_UUID_PREFIX):
            return
        self.discovered[ident] = {'uuid': ident, 'rssi': int(rssi), 'seen_at': time.time()}
        self.report()

    @dbus.service.method(PROVISIONER, in_signature='y', out_signature='qq')
    def RequestProvData(self, count):
        address = self.state['next_address']
        self.report('provision_data_requested', requested_elements=int(count),
                    allocated_address=hex(address))
        if not self.provisioning or not 1 <= int(count) <= 255 or address + count > 0x8000:
            raise dbus.exceptions.DBusException('Cannot allocate address range', name=SERVICE + '.Error.Abort')
        # Reserve before returning. Failed provisioning consumes addresses intentionally.
        self.state['next_address'] = address + int(count)
        self.persist()
        return dbus.UInt16(NET_INDEX), dbus.UInt16(address)

    @dbus.service.method(PROVISIONER, in_signature='ayqy', out_signature='')
    def AddNodeComplete(self, device_uuid, unicast, count):
        ident, address = bytes(device_uuid).hex(), int(unicast)
        self.provisioning = None
        self.state['nodes'][ident] = {
            'address': address,
            'count': int(count),
            'provisioned': True,
            'appkey': False,
            'bind': False,
            'publication': False,
            'configured': False,
        }
        self.persist()
        self.discovered.pop(ident, None)
        try:
            self.register(ident, address)
            self.configure(address, int(count))
        except Exception as error:
            self.report('configuration_failed', address=hex(address), error=str(error))

    @dbus.service.method(PROVISIONER, in_signature='ays', out_signature='')
    def AddNodeFailed(self, device_uuid, reason):
        self.provisioning = None
        self.report('provision_failed', error=str(reason))

    def register(self, ident, address):
        with database() as conn:
            row = conn.execute('SELECT id FROM ble_nodes WHERE uuid=?', (ident,)).fetchone()
            if row:
                conn.execute('UPDATE ble_nodes SET mesh_address=? WHERE uuid=?', (hex(address), ident))
                return
            zone = conn.execute('INSERT INTO zones(name,description,mesh_address) VALUES(?,?,?)',
                                (f'Khu {address:04x}', f'ESP32 {ident}', hex(address))).lastrowid
            conn.execute('INSERT INTO ble_nodes(uuid,mesh_address,name,zone_id,status) VALUES(?,?,?,?,?)',
                         (ident, hex(address), f'Node-{address:04x}', zone, 'provisioned'))

    def configure(self, address, count):
        self.pending = {'address': address, 'count': count, 'stage': 'composition', 'attempt': 0}
        if address == PI_ADDRESS:
            self.pending.update(stage='appkey', elements=[PI_ADDRESS])
        self.report('configuring', address=hex(address))
        self.send_step()

    def send_step(self):
        pending = self.pending
        if pending is None:
            return False
        pending['attempt'] += 1
        if pending['attempt'] > 3:
            self.config_failed('No configuration response after 3 attempts')
            return False
        address, stage = pending['address'], pending['stage']
        # Schedule before sending: a local loopback response can arrive immediately.
        self.timer = GLib.timeout_add_seconds(10, self.retry)
        try:
            if stage == 'appkey':
                self.node.AddAppKey(ELEMENT_PATH, dbus.UInt16(address), dbus.UInt16(APP_INDEX),
                                    dbus.UInt16(NET_INDEX), False, reply_handler=lambda: None,
                                    error_handler=lambda e: self.step_error(pending, e))
            else:
                data = (b'\x80\x08\x00' if stage == 'composition' else
                        bind_request(pending['elements'][0]) if stage == 'bind' else
                        publication_request(pending['elements'][0]))
                self.node.DevKeySend(ELEMENT_PATH, dbus.UInt16(address), True, dbus.UInt16(NET_INDEX),
                                     dbus.Dictionary({}, signature='sv'), dbus.ByteArray(data),
                                     reply_handler=lambda: None,
                                     error_handler=lambda e: self.step_error(pending, e))
        except Exception as error:
            self.step_error(pending, error)
        return False

    def step_error(self, pending, error):
        if self.pending is pending:
            self.config_failed(str(error))

    def retry(self):
        self.timer = None
        self.send_step()
        return False

    def cancel_timer(self):
        if self.timer is not None:
            GLib.source_remove(self.timer)
            self.timer = None

    def cancel_scan_timer(self):
        if self.scan_timer is not None:
            GLib.source_remove(self.scan_timer)
            self.scan_timer = None

    def scan_complete(self):
        self.scan_timer = None
        if self.status.get('state') == 'scanning':
            self.report('attached')
        return False

    def cancel_scan(self):
        self.cancel_scan_timer()
        try:
            self.manager.UnprovisionedScanCancel()
        except dbus.DBusException as error:
            print(f'Ignoring scan cancel error before provisioning: {error}', flush=True)

    def config_failed(self, error):
        self.cancel_timer()
        address = self.pending['address'] if self.pending else None
        self.pending = None
        if address == PI_ADDRESS:
            self.ready = False
        self.report('configuration_failed', address=hex(address) if address else None, error=str(error))

    def configuration_response(self, source, net_index, data):
        pending = self.pending
        if not pending or source != pending['address'] or net_index != NET_INDEX:
            return
        stage = pending['stage']
        if stage == 'composition':
            if data[:2] != b'\x02\x00':
                return
            try:
                pending['elements'] = vendor_elements(data, source, pending['count'])
                pending['vendor_element_count'] = len(pending['elements'])
            except ValueError as error:
                self.config_failed(error)
                return
        else:
            code = expected_status(stage, data, pending['elements'][0])
            if code is None:
                return
            if code != 0:
                self.config_failed(f'{stage} rejected with Mesh status 0x{code:02x}')
                return
            if source != PI_ADDRESS:
                if stage == 'appkey':
                    self.set_node_flags(source, appkey=True)
                elif stage == 'bind':
                    pending['bind_count'] = pending.get('bind_count', 0) + 1
                    if pending['bind_count'] >= pending.get('vendor_element_count', 1):
                        self.set_node_flags(source, bind=True)
                elif stage == 'publication':
                    pending['publication_count'] = pending.get('publication_count', 0) + 1
                    if pending['publication_count'] >= pending.get('vendor_element_count', 1):
                        self.set_node_flags(source, publication=True)
        self.cancel_timer()
        if stage == 'composition':
            pending['stage'] = 'appkey'
        elif stage == 'appkey':
            pending['stage'] = 'bind'
        elif stage == 'bind' and source != PI_ADDRESS:
            pending['stage'] = 'publication'
        elif stage == 'publication' and len(pending['elements']) > 1:
            pending['elements'].pop(0)
            pending['stage'] = 'bind'
        else:
            if source == PI_ADDRESS:
                self.pending = None
                self.ready = True
                self.report('attached')
            else:
                records = self.node_records_for_address(source)
                required = ('provisioned', 'appkey', 'bind', 'publication')
                complete = bool(records) and all(all(record.get(flag) for flag in required)
                                                 for record in records)
                if not complete:
                    self.config_failed('Node is missing required mesh setup flags')
                    return
                try:
                    with database() as conn:
                        conn.execute('UPDATE ble_nodes SET status=? WHERE mesh_address=?', ('configured', hex(source)))
                    for record in records:
                        record['configured'] = True
                    self.persist()
                except (sqlite3.Error, OSError) as error:
                    for record in records:
                        record['configured'] = False
                    self.config_failed(f'Cannot save configured node: {error}')
                    return
                self.pending = None
                self.report('node_configured', address=hex(source),
                            provisioned=True, appkey=True, bind=True, publication=True)
            return
        # New object prevents late D-Bus errors for a previous step affecting this step.
        self.pending = dict(pending, attempt=0)
        self.send_step()

    def command(self, request):
        action = request.get('action')
        if action == 'status':
            return {'success': True, 'data': self.status}
        if not self.ready:
            raise ValueError('Gateway is not ready; inspect status/logs')
        if self.pending or self.provisioning:
            raise ValueError('Gateway is busy provisioning/configuring a node')
        if action == 'scan':
            self.discovered.clear()
            self.cancel_scan_timer()
            self.manager.UnprovisionedScan(dbus.Dictionary({'Seconds': dbus.UInt16(30)}, signature='sv'),
                                          reply_handler=lambda: self.report('scanning'),
                                          error_handler=lambda e: self.report('scan_failed', error=str(e)))
            self.scan_timer = GLib.timeout_add_seconds(31, self.scan_complete)
        elif action == 'provision':
            ident = uuid.UUID(request['uuid']).hex
            if not ident.startswith(DEVICE_UUID_PREFIX):
                raise ValueError('ESP32 UUID must start with SPM1')
            if ident in self.state['nodes']:
                raise ValueError('Node already provisioned; use configure to retry configuration')
            if ident not in self.discovered or time.time() - self.discovered[ident]['seen_at'] > 120:
                raise ValueError('Scan again before provisioning this UUID')
            self.cancel_scan()
            self.provisioning = ident
            self.report('provisioning', uuid=ident)
            self.manager.AddNode(dbus.ByteArray(bytes.fromhex(ident)), dbus.Dictionary({}, signature='sv'),
                                 reply_handler=lambda: None,
                                 error_handler=lambda e: self.AddNodeFailed(bytes.fromhex(ident), str(e)))
        elif action == 'configure':
            ident = uuid.UUID(request['uuid']).hex
            record = self.state['nodes'].get(ident)
            if not record:
                raise ValueError('Unknown provisioned UUID')
            self.register(ident, record['address'])
            record.update(provisioned=True, appkey=False, bind=False, publication=False, configured=False)
            self.persist()
            self.configure(record['address'], record['count'])
        else:
            raise ValueError('Unknown action')
        return {'success': True, 'message': 'Request accepted; inspect status for completion'}


class Element(dbus.service.Object):
    def __init__(self, bus, gateway):
        super().__init__(bus, ELEMENT_PATH)
        self.gateway = gateway

    @dbus.service.method(ELEMENT, in_signature='qqvay', out_signature='')
    def MessageReceived(self, source, key_index, destination, data):
        parsed = sensor_message(data)
        if int(key_index) != APP_INDEX or parsed is None:
            return
        record = next((record for record in self.gateway.state['nodes'].values()
                       if record['address'] <= source < record['address'] + record['count']), None)
        if not record or not record['configured']:
            return
        try:
            with database() as conn:
                row = conn.execute('SELECT zone_id FROM ble_nodes WHERE mesh_address=?',
                                   (hex(record['address']),)).fetchone()
                if row is None:
                    return
                conn.execute('INSERT INTO sensor_data(temperature,humidity,light,soil_moisture,zone_id) VALUES(?,?,?,?,?)',
                             (*parsed.values(), row['zone_id']))
                conn.execute('UPDATE ble_nodes SET status=?,last_seen=CURRENT_TIMESTAMP WHERE mesh_address=?',
                             ('active', hex(record['address'])))
            print(f'Sensor 0x{source:04x}: {parsed}', flush=True)
        except sqlite3.Error as error:
            self.gateway.report(error=f'Database: {error}')

    @dbus.service.method(ELEMENT, in_signature='qbqay', out_signature='')
    def DevKeyMessageReceived(self, source, remote, net_index, data):
        self.gateway.configuration_response(int(source), int(net_index), bytes(data))

    @dbus.service.method(ELEMENT, in_signature='qa{sv}', out_signature='')
    def UpdateModelConfiguration(self, model_id, config):
        pass


class ProvisionAgent(dbus.service.Object):
    def __init__(self, bus):
        super().__init__(bus, APP_PATH + '/agent')

    @dbus.service.method(PROPERTIES, in_signature='s', out_signature='a{sv}')
    def GetAll(self, interface):
        if interface != AGENT:
            return dbus.Dictionary({}, signature='sv')
        return dbus.Dictionary({
            'Capabilities': dbus.Array([], signature='s'),
        }, signature='sv')

    @dbus.service.method(PROPERTIES, in_signature='ss', out_signature='v')
    def Get(self, interface, name):
        if interface == AGENT and name == 'Capabilities':
            return dbus.Array([], signature='s')
        raise dbus.exceptions.DBusException(
            f'No such property {name}',
            name='org.freedesktop.DBus.Error.InvalidArgs',
        )

    @dbus.service.method(AGENT, in_signature='', out_signature='')
    def Cancel(self):
        pass


class CommandHandler(socketserver.StreamRequestHandler):
    def handle(self):
        self.connection.settimeout(5)
        try:
            line = self.rfile.readline(4097)
            if len(line) > 4096 or not line.endswith(b'\n'):
                raise ValueError('Invalid command')
            request = json.loads(line)
            if not isinstance(request, dict):
                raise ValueError('Expected JSON object')
            event, result = threading.Event(), {}
            def dispatch():
                try:
                    result.update(self.server.gateway.command(request))
                except Exception as error:
                    result.update(success=False, error=str(error))
                finally:
                    event.set()
                return False
            GLib.idle_add(dispatch)
            event.wait()  # GLib owns all mesh state and D-Bus calls.
            self.wfile.write(json.dumps(result).encode() + b'\n')
        except (ValueError, OSError) as error:
            try:
                self.wfile.write(json.dumps({'success': False, 'error': str(error)}).encode() + b'\n')
            except OSError:
                pass


class CommandServer(socketserver.ThreadingUnixStreamServer):
    daemon_threads = True


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('action', nargs='?', default='run', choices=['run', 'status', 'scan', 'provision', 'configure'])
    parser.add_argument('uuid', nargs='?')
    args = parser.parse_args()
    if args.action != 'run':
        with socket.socket(socket.AF_UNIX, socket.SOCK_STREAM) as client:
            client.settimeout(5)
            client.connect(SOCKET_PATH)
            client.sendall(json.dumps({'action': args.action, 'uuid': args.uuid}).encode() + b'\n')
            response = json.loads(client.makefile('rb').readline())
            print(json.dumps(response, indent=2))
            return 0 if response['success'] else 1
    STATE_DIR.mkdir(parents=True, exist_ok=True, mode=0o700)
    # Lock the shared socket location, even if two processes choose different state directories.
    with open(SOCKET_PATH + '.lock', 'w') as lock:
        fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
        with database() as conn:
            conn.execute('SELECT uuid FROM ble_nodes LIMIT 1')  # Server initializes the schema.
        dbus.mainloop.glib.DBusGMainLoop(set_as_default=True)
        gateway = Gateway(dbus.SystemBus())
        if os.path.exists(SOCKET_PATH):
            os.unlink(SOCKET_PATH)
        server = CommandServer(SOCKET_PATH, CommandHandler)
        server.gateway = gateway
        os.chmod(SOCKET_PATH, 0o660)
        threading.Thread(target=server.serve_forever, daemon=True).start()
        loop = GLib.MainLoop()
        def stop(*_):
            loop.quit()
        signal.signal(signal.SIGTERM, stop)
        signal.signal(signal.SIGINT, stop)
        try:
            gateway.start()
            loop.run()
        finally:
            gateway.ready = False
            gateway.report('stopped')
            server.shutdown()
            server.server_close()
            os.unlink(SOCKET_PATH)
    return 0


if __name__ == '__main__':
    try:
        raise SystemExit(main())
    except (OSError, ValueError, RuntimeError, sqlite3.Error, dbus.DBusException) as error:
        print(f'BLE Mesh startup failed: {error}', flush=True)
        raise SystemExit(1)
