import os
import json
import pty
import select
import threading
import time
import sqlite3
import tempfile
import unittest
from unittest.mock import patch

import ble_mesh_gateway as gateway


UUID = '53504d31f105010020e7c867144e0001'


class GatewayTest(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.db_path = os.path.join(self.temp.name, 'test.db')
        with sqlite3.connect(self.db_path) as conn:
            conn.executescript('''
                CREATE TABLE zones (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    name TEXT NOT NULL UNIQUE,
                    description TEXT,
                    mesh_address TEXT
                );
                CREATE TABLE ble_nodes (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    uuid TEXT NOT NULL UNIQUE,
                    mesh_address TEXT,
                    name TEXT,
                    zone_id INTEGER,
                    status TEXT DEFAULT 'unprovisioned',
                    last_seen DATETIME
                );
                CREATE TABLE pest_detections (id INTEGER PRIMARY KEY, zone_id INTEGER);
                CREATE TABLE sensor_data (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    temperature REAL,
                    humidity REAL,
                    light REAL,
                    soil_moisture REAL,
                    zone_id INTEGER
                );
            ''')
        self.db_patch = patch.object(gateway, 'DB_PATH', self.db_path)
        self.db_patch.start()
        self.gateway = gateway.Gateway()

    def tearDown(self):
        self.db_patch.stop()
        self.temp.cleanup()

    def test_uuid_must_be_smart_plant_device(self):
        self.assertEqual(gateway.normalize_uuid(UUID), UUID)
        with self.assertRaisesRegex(ValueError, 'SPM1'):
            gateway.normalize_uuid('00' * 16)

    def test_scan_node_and_sensor_events_update_status_and_database(self):
        self.gateway.handle_event({'event': 'scan_result', 'uuid': UUID, 'rssi': -61})
        self.assertEqual(self.gateway.snapshot()['devices'][0]['rssi'], -61)

        self.gateway.handle_event({
            'event': 'node', 'uuid': UUID, 'address': '0x0002',
            'provisioned': True, 'appkey': True, 'bind': True, 'publication': True,
        })
        self.assertEqual(self.gateway.snapshot()['state'], 'scanning')

        self.gateway.handle_event({
            'event': 'sensor', 'address': '0x0002', 'temperature': 27.8,
            'humidity': 65.75, 'light': 415, 'soil_moisture': 45.65,
        })
        with sqlite3.connect(self.db_path) as conn:
            node = conn.execute('SELECT status,mesh_address FROM ble_nodes').fetchone()
            reading = conn.execute(
                'SELECT temperature,humidity,light,soil_moisture FROM sensor_data'
            ).fetchone()
        self.assertEqual(node, ('active', '0x0002'))
        self.assertEqual(reading, (27.8, 65.75, 415.0, 45.65))

    def test_incomplete_node_cannot_write_sensor_data(self):
        self.gateway.handle_event({
            'event': 'node', 'uuid': UUID, 'address': 2,
            'provisioned': True, 'appkey': True, 'bind': False, 'publication': False,
        })
        with self.assertRaisesRegex(ValueError, 'unconfigured'):
            self.gateway.handle_event({
                'event': 'sensor', 'address': 2, 'temperature': 25,
                'humidity': 60, 'light': 300, 'soil_moisture': 40,
            })

    def test_command_is_forwarded_as_json(self):
        read_fd, write_fd = os.pipe()
        try:
            self.gateway.fd = write_fd
            self.gateway.status['ready'] = True
            result = self.gateway.command({'action': 'provision', 'uuid': UUID})
            self.assertTrue(result['success'])
            self.assertEqual(
                os.read(read_fd, 1024),
                ('{"action":"provision","uuid":"' + UUID + '"}\n').encode(),
            )
        finally:
            os.close(read_fd)
            os.close(write_fd)
            self.gateway.fd = None

    def test_reconnect_retries_handshake_and_replays_nodes(self):
        master, slave = pty.openpty()
        port = os.ttyname(slave)
        worker = None
        try:
            with patch.object(gateway, 'serial_candidates', return_value=[port]), \
                 patch.object(gateway, 'STATUS_INTERVAL', 0.05):
                worker = threading.Thread(target=self.gateway.run)
                worker.start()
                buffer = b''
                requests = 0
                deadline = time.monotonic() + 5
                while time.monotonic() < deadline:
                    if not select.select([master], [], [], 0.1)[0]:
                        continue
                    buffer += os.read(master, 4096)
                    while b'\n' in buffer:
                        line, buffer = buffer.split(b'\n', 1)
                        if json.loads(line).get('action') != 'status':
                            continue
                        requests += 1
                        # Simulate first status lost while ESP32 boots.
                        if requests == 2:
                            os.write(master, b'ets ROM boot\n{"event":"gateway","ready":true,"state":"attached"}\n')
                        elif requests == 3:
                            node = dict(event='node', uuid=UUID, address='0x0002',
                                        **{flag: True for flag in gateway.REQUIRED_FLAGS})
                            os.write(master, json.dumps(node).encode() + b'\n')
                    if self.gateway.snapshot()['nodes']:
                        break
                self.assertGreaterEqual(requests, 3)
                deadline = time.monotonic() + 2
                while not self.gateway.snapshot()['nodes'] and time.monotonic() < deadline:
                    time.sleep(0.01)
                snapshot = self.gateway.snapshot()
                self.assertTrue(snapshot['ready'])
                self.assertTrue(snapshot['nodes'][0]['configured'])
                self.assertEqual(snapshot['state'], 'attached')
                self.assertNotIn('error', snapshot)
        finally:
            self.gateway.stop_event.set()
            if worker:
                worker.join(3)
            self.gateway.disconnect()
            os.close(master)
            os.close(slave)

    def test_disconnect_clears_stale_discovery(self):
        self.gateway.handle_event({'event': 'scan_result', 'uuid': UUID, 'rssi': -61})
        self.gateway.disconnect()
        self.assertEqual(self.gateway.snapshot()['devices'], [])
        self.assertFalse(self.gateway.snapshot()['ready'])

    def test_no_serial_port_reports_actionable_error(self):
        with patch.object(gateway, 'serial_candidates', return_value=[]):
            self.assertFalse(self.gateway.connect())
        self.assertIn('USB', self.gateway.snapshot()['error'])

    def test_failed_serial_setup_closes_fd(self):
        with patch.object(gateway, 'serial_candidates', return_value=['/dev/test']), \
             patch.object(gateway.os, 'open', return_value=99), \
             patch.object(gateway.fcntl, 'flock'), \
             patch.object(gateway, 'configure_serial', side_effect=OSError('setup failed')), \
             patch.object(gateway.os, 'close') as close:
            self.assertFalse(self.gateway.connect())
            close.assert_called_once_with(99)
        self.assertIsNone(self.gateway.fd)

    def test_duplicate_join_rejected_until_operation_finishes(self):
        self.gateway.fd = 99
        self.gateway.status.update(ready=True, state='attached')
        with patch.object(self.gateway, 'write') as write:
            self.gateway.command({'action': 'provision', 'uuid': UUID})
            self.assertEqual(self.gateway.snapshot()['state'], 'provisioning')
            with self.assertRaises(ValueError):
                self.gateway.command({'action': 'provision', 'uuid': UUID})
            with self.assertRaises(ValueError):
                self.gateway.command({'action': 'scan'})
            write.assert_called_once()
            self.gateway.handle_event({'event': 'scan_result', 'uuid': UUID, 'rssi': -60})
            self.assertEqual(self.gateway.snapshot()['state'], 'provisioning')
            self.gateway.handle_event({'event': 'error', 'message': 'Gateway busy; wait for the current operation'})
            self.assertEqual(self.gateway.snapshot()['state'], 'provisioning')
            self.assertEqual(write.call_args.args[0], {'action': 'status'})
            self.gateway.handle_event({'event': 'state', 'state': 'provision_failed', 'ready': True})
            self.gateway.command({'action': 'scan'})
            self.assertEqual(self.gateway.snapshot()['state'], 'scanning')
        self.gateway.fd = None

    def test_zone_created_only_after_full_configuration(self):
        event = dict(event='node', uuid=UUID, address=2, provisioned=True,
                     appkey=True, bind=False, publication=False)
        self.gateway.handle_event(event)
        with sqlite3.connect(self.db_path) as db:
            self.assertEqual(db.execute('SELECT COUNT(*) FROM zones').fetchone()[0], 0)
            self.assertIsNone(db.execute('SELECT zone_id FROM ble_nodes').fetchone()[0])
        event.update(bind=True, publication=True)
        self.gateway.handle_event(event)
        self.gateway.handle_event(event)
        with sqlite3.connect(self.db_path) as db:
            self.assertEqual(db.execute('SELECT COUNT(*) FROM zones').fetchone()[0], 1)
            self.assertIsNotNone(db.execute('SELECT zone_id FROM ble_nodes').fetchone()[0])

    def test_remove_waits_for_ack_and_does_not_return_after_restart(self):
        event = dict(event='node', uuid=UUID, address=2,
                     **{flag: True for flag in gateway.REQUIRED_FLAGS})
        self.gateway.handle_event(event)
        self.gateway.fd = 99
        self.gateway.status.update(ready=True, state='attached', firmware='1.1.0')
        with patch.object(self.gateway, 'write') as write:
            self.gateway.command({'action': 'remove', 'uuid': UUID})
            write.assert_called_with({'action': 'remove', 'uuid': UUID})
            with sqlite3.connect(self.db_path) as db:
                self.assertEqual(db.execute('SELECT COUNT(*) FROM ble_nodes').fetchone()[0], 1)
            self.gateway.handle_event({'event': 'node_removed', 'uuid': UUID})
        self.gateway.fd = None
        restored = gateway.Gateway()
        restored.handle_event(event)
        with sqlite3.connect(self.db_path) as db:
            self.assertEqual(db.execute('SELECT COUNT(*) FROM ble_nodes').fetchone()[0], 0)
            self.assertEqual(db.execute('SELECT COUNT(*) FROM zones').fetchone()[0], 0)
        self.assertEqual(restored.snapshot()['nodes'], [])

    def test_failed_removal_keeps_node(self):
        self.gateway.handle_event(dict(event='node', uuid=UUID, address=2,
                                      **{flag: True for flag in gateway.REQUIRED_FLAGS}))
        self.gateway.fd = 99
        self.gateway.status.update(ready=True, state='attached', firmware='1.1.0')
        with patch.object(self.gateway, 'write'):
            self.gateway.command({'action': 'remove', 'uuid': UUID})
            self.gateway.handle_event(dict(event='state', state='remove_failed', ready=True, error='timeout'))
        self.gateway.fd = None
        with sqlite3.connect(self.db_path) as db:
            self.assertEqual(db.execute('SELECT COUNT(*) FROM ble_nodes').fetchone()[0], 1)
            self.assertEqual(db.execute('SELECT state FROM mesh_removals').fetchone()[0], 'failed')


if __name__ == '__main__':
    unittest.main()
