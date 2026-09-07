"""Run: /usr/bin/python3 -m unittest discover -s ai_engine -p 'test_ble_mesh.py' -v"""
import json
from pathlib import Path
import struct
import tempfile
import unittest
from unittest.mock import Mock, patch

import ble_mesh_gateway as gateway
from ble_mesh_protocol import (MODEL, SENSOR_OPCODE, bind_request, expected_status,
                               publication_request, sensor_message, vendor_elements)


def composition(models):
    return b'\x02\x00' + bytes(10) + b''.join(
        struct.pack('<HBB', 0, 1, len(vendors)) + b'\x00\x00' + b''.join(vendors)
        for vendors in models)


class ProtocolTests(unittest.TestCase):
    def test_sensor_opcode_and_signed_temperature(self):
        packet = SENSOR_OPCODE + struct.pack('<hHHH', -525, 6500, 400, 4520)
        self.assertEqual(sensor_message(packet), dict(temperature=-5.25, humidity=65, light=400, soil_moisture=45.2))
        self.assertEqual(sensor_message(packet + bytes(4)), sensor_message(packet))
        for invalid in (packet[3:], b'\xc2' + packet[1:], packet[:-1], packet + b'\0', packet + bytes(5)):
            self.assertIsNone(sensor_message(invalid))
        self.assertIsNone(sensor_message(SENSOR_OPCODE + struct.pack('<hHHH', 0, 10001, 0, 0)))

    def test_composition_multiple_elements(self):
        data = composition([[], [MODEL], [MODEL]])
        self.assertEqual(vendor_elements(data, 5, 3), [6, 7])
        for invalid, count in ((data[:-1], 3), (data, 2), (composition([[]]), 1), (data[:11], 3)):
            with self.assertRaises(ValueError):
                vendor_elements(invalid, 5, count)

    def test_correlate_status(self):
        self.assertEqual(expected_status('appkey', b'\x80\x03\x00\0\0\0'), 0)
        self.assertIsNone(expected_status('appkey', b'\x80\x03\x00\1\0\0'))
        reply = b'\x80\x3e\x00' + bind_request(3)[2:]
        self.assertEqual(expected_status('bind', reply, 3), 0)
        self.assertIsNone(expected_status('bind', reply, 4))
        reply = b'\x80\x19\x00' + publication_request(3)[1:]
        self.assertEqual(expected_status('publication', reply, 3), 0)
        self.assertIsNone(expected_status('publication', reply, 4))
        self.assertEqual(expected_status('publication', reply[:2] + b'\x07' + reply[3:], 3), 7)


class GatewayTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.g = gateway.Gateway.__new__(gateway.Gateway)
        self.g.node = Mock()
        self.g.manager = Mock()
        self.g.report = Mock()
        self.g.ready = True
        self.g.pending = self.g.timer = self.g.provisioning = None
        self.g.discovered = {}
        self.g.state_path = Path(self.temp.name) / 'network.json'
        self.g.state = {'next_address': 2, 'nodes': {}}
        self.g.register = Mock()
        self.db = Mock()
        self.db.__enter__ = Mock(return_value=self.db)
        self.db.__exit__ = Mock(return_value=False)
        for name, value in [('database', Mock(return_value=self.db)),
                            ('GLib.timeout_add_seconds', Mock(return_value=100)),
                            ('GLib.source_remove', Mock())]:
            p = patch('ble_mesh_gateway.' + name, value)
            p.start()
            self.addCleanup(p.stop)

    def reply(self, data, source=2):
        self.g.configuration_response(source, 0, data)

    def test_full_remote_configuration_and_restart_state(self):
        self.g.state['nodes']['ab' * 16] = {'address': 2, 'count': 2, 'configured': False}
        self.g.configure(2, 2)
        self.reply(composition([[], [MODEL]]))
        self.assertEqual(self.g.pending['stage'], 'appkey')
        self.reply(b'\x80\x03\x00\0\0\0', source=9)
        self.assertEqual(self.g.pending['stage'], 'appkey')
        self.reply(b'\x80\x03\x00\0\0\0')
        self.assertEqual(self.g.pending['stage'], 'bind')
        self.reply(b'\x80\x3e\x00' + bind_request(3)[2:])
        self.assertEqual(self.g.pending['stage'], 'publication')
        self.reply(b'\x80\x19\x00' + publication_request(3)[1:])
        self.assertIsNone(self.g.pending)
        saved = json.loads(self.g.state_path.read_text())
        self.assertTrue(saved['nodes']['ab' * 16]['configured'])
        self.g.report.assert_called_with('node_configured', address='0x2')

    def test_database_failure_is_reported_after_configuration(self):
        self.g.state['nodes']['ab' * 16] = {'address': 2, 'count': 1, 'configured': False}
        self.g.configure(2, 1)
        self.reply(composition([[MODEL]]))
        self.reply(b'\x80\x03\x00\0\0\0')
        self.reply(b'\x80\x3e\x00' + bind_request(2)[2:])
        self.db.execute.side_effect = gateway.sqlite3.OperationalError('database locked')
        self.reply(b'\x80\x19\x00' + publication_request(2)[1:])
        self.assertFalse(self.g.state['nodes']['ab' * 16]['configured'])
        self.assertIsNone(self.g.pending)
        self.assertEqual(self.g.report.call_args.args[0], 'configuration_failed')

    def test_local_configuration(self):
        self.g.ready = False
        self.g.configure_local()
        self.reply(b'\x80\x03\x00\0\0\0', source=1)
        self.reply(b'\x80\x3e\x00' + bind_request(1)[2:], source=1)
        self.assertTrue(self.g.ready)
        self.assertIsNone(self.g.pending)
        self.g.report.assert_called_with('attached')

    def test_reserve_entire_range_before_reply(self):
        self.g.provisioning = 'ab' * 16
        self.assertEqual(tuple(map(int, self.g.RequestProvData(3))), (0, 2))
        self.assertEqual(json.loads(self.g.state_path.read_text())['next_address'], 5)
        self.assertEqual(tuple(map(int, self.g.RequestProvData(2))), (0, 5))
        self.g.state['next_address'] = 0x7fff
        with self.assertRaises(gateway.dbus.DBusException):
            self.g.RequestProvData(2)

    def test_retry_timeout_does_not_mark_node_configured(self):
        self.g.configure(2, 1)
        for _ in range(3):
            self.g.retry()
        self.assertEqual(self.g.node.DevKeySend.call_count, 3)
        self.assertIsNone(self.g.pending)
        self.assertEqual(self.g.report.call_args.args[0], 'configuration_failed')

    def test_negative_status_stops_configuration(self):
        self.g.configure(2, 1)
        self.reply(composition([[MODEL]]))
        self.reply(b'\x80\x03\x03\0\0\0')
        self.assertIsNone(self.g.pending)
        self.assertIn('0x03', self.g.report.call_args.kwargs['error'])

    def test_stale_dbus_error_does_not_abort_next_step(self):
        self.g.configure(2, 1)
        old_pending = self.g.pending
        self.reply(composition([[MODEL]]))
        self.g.step_error(old_pending, RuntimeError('late'))
        self.assertEqual(self.g.pending['stage'], 'appkey')

    def test_scan_uuid_excludes_oob_bytes(self):
        self.g.ScanResult(-40, bytes.fromhex('ab' * 16) + b'\0\0', {})
        self.assertEqual(list(self.g.discovered), ['ab' * 16])
        self.assertTrue(self.g.command({'action': 'provision', 'uuid': 'ab' * 16})['success'])
        self.assertEqual(bytes(self.g.manager.AddNode.call_args.args[0]), bytes.fromhex('ab' * 16))
        with self.assertRaises(ValueError):
            self.g.command({'action': 'scan'})

    def test_no_provision_without_fresh_scan(self):
        with self.assertRaises(ValueError):
            self.g.command({'action': 'provision', 'uuid': 'ab' * 16})
        self.g.discovered['ab' * 16] = {'seen_at': 0}
        with self.assertRaises(ValueError):
            self.g.command({'action': 'provision', 'uuid': 'ab' * 16})

    def test_dbus_signatures(self):
        self.assertEqual(gateway.Element.DevKeyMessageReceived._dbus_in_signature, 'qbqay')
        self.assertEqual(gateway.Gateway.ScanResult._dbus_in_signature, 'naya{sv}')
        objects = self.g.GetManagedObjects()
        self.assertEqual(str(objects[gateway.ELEMENT_PATH][gateway.ELEMENT]['Models'].signature), '(qa{sv})')
        self.assertEqual(str(objects[gateway.ELEMENT_PATH][gateway.ELEMENT]['VendorModels'].signature), '(qqa{sv})')


if __name__ == '__main__':
    unittest.main()
