import os
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
        self.assertEqual(self.gateway.snapshot()['state'], 'node_configured')

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


if __name__ == '__main__':
    unittest.main()
