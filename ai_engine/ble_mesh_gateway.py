#!/usr/bin/env python3
"""
Smart Plant - BLE Mesh Gateway (Raspberry Pi 4)
===============================================
Script Python chạy ngầm trên Pi 4 đóng vai trò Provisioner / Gateway
cho mạng lưới BLE Mesh. Sử dụng chip Bluetooth 5.0 tích hợp sẵn trên Pi.

Giao tiếp với BlueZ qua D-Bus và ghi dữ liệu cảm biến nhận được
từ các Node ESP32 vào CSDL SQLite.

Chạy: python3 ble_mesh_gateway.py
"""

import dbus
import dbus.service
import dbus.mainloop.glib
from gi.repository import GLib
import struct
import json
import sqlite3
import os
import sys
import time
import subprocess

# --- Configuration ---
MESH_APP_PATH = '/smart_plant/mesh'
MESH_ELEMENT_PATH = MESH_APP_PATH + '/element0'
DB_PATH = os.environ.get('DB_PATH', os.path.join(os.path.dirname(__file__), '..', 'server', 'db', 'smart_plant.db'))
STATUS_FILE = os.path.join(os.path.dirname(__file__), '..', 'ble_mesh_status.json')
TOKEN_FILE = os.path.join(os.path.dirname(__file__), 'mesh_token.dat')

# BLE Mesh Model IDs
SENSOR_SERVER_MODEL_ID = 0x1100
SENSOR_CLIENT_MODEL_ID = 0x1102

# Vendor-specific model for Smart Plant custom data
VENDOR_ID = 0x05F1  # Custom vendor ID
VENDOR_MODEL_ID = 0x0001

# D-Bus interfaces
BLUEZ_MESH_SERVICE = 'org.bluez.mesh'
MESH_NETWORK_IFACE = 'org.bluez.mesh.Network1'
MESH_NODE_IFACE = 'org.bluez.mesh.Node1'
MESH_MANAGEMENT_IFACE = 'org.bluez.mesh.Management1'
MESH_APPLICATION_IFACE = 'org.bluez.mesh.Application1'
MESH_PROVISIONER_IFACE = 'org.bluez.mesh.Provisioner1'
MESH_PROVISION_AGENT_IFACE = 'org.bluez.mesh.ProvisionAgent1'
MESH_ELEMENT_IFACE = 'org.bluez.mesh.Element1'

DBUS_OM_IFACE = 'org.freedesktop.DBus.ObjectManager'
DBUS_PROP_IFACE = 'org.freedesktop.DBus.Properties'

bus = None
mainloop = None
mesh_net = None
node = None
node_mgr = None
app = None
token = None

# --- Database Helper ---
def get_db():
    """Get SQLite database connection"""
    db_dir = os.path.dirname(DB_PATH)
    if not os.path.exists(db_dir):
        os.makedirs(db_dir, exist_ok=True)
    conn = sqlite3.connect(DB_PATH)
    conn.row_factory = sqlite3.Row
    return conn

def save_sensor_data(mesh_addr, temperature, humidity, light, soil_moisture):
    """Save sensor data from BLE Mesh node to database"""
    conn = get_db()
    try:
        # Find zone by mesh_address
        zone = conn.execute(
            'SELECT id FROM zones WHERE mesh_address = ?',
            (hex(mesh_addr),)
        ).fetchone()

        zone_id = zone['id'] if zone else None

        conn.execute(
            'INSERT INTO sensor_data (temperature, humidity, light, soil_moisture, zone_id) VALUES (?, ?, ?, ?, ?)',
            (temperature, humidity, light, soil_moisture, zone_id)
        )

        # Update ble_nodes last_seen
        conn.execute(
            'UPDATE ble_nodes SET last_seen = CURRENT_TIMESTAMP, status = ? WHERE mesh_address = ?',
            ('active', hex(mesh_addr))
        )

        conn.commit()
        print(f'📊 Data saved: Node 0x{mesh_addr:04x} -> Zone {zone_id} | T={temperature}°C H={humidity}% L={light} SM={soil_moisture}%')
    except Exception as e:
        print(f'❌ DB Error: {e}')
    finally:
        conn.close()

def register_new_node(uuid_hex, mesh_addr, name=None):
    """Register a newly provisioned node and auto-create a Zone for it"""
    conn = get_db()
    try:
        node_name = name or f'Node-{mesh_addr:04x}'

        # Count existing zones to generate zone letter (A, B, C, ...)
        cursor = conn.execute('SELECT COUNT(*) as count FROM zones')
        zone_count = cursor.fetchone()[0]
        zone_letter = chr(ord('A') + zone_count)
        zone_name = f'Khu {zone_letter}'

        # Create a new Zone for this node
        cursor = conn.execute(
            'INSERT INTO zones (name, description, status, mesh_address) VALUES (?, ?, ?, ?)',
            (zone_name, f'Khu vực cảm biến {node_name}', 'active', hex(mesh_addr))
        )
        zone_id = cursor.lastrowid

        # Register the BLE node and link to the new zone
        conn.execute('''
            INSERT OR REPLACE INTO ble_nodes (uuid, mesh_address, name, zone_id, status, last_seen)
            VALUES (?, ?, ?, ?, 'provisioned', CURRENT_TIMESTAMP)
        ''', (uuid_hex, hex(mesh_addr), node_name, zone_id))

        conn.commit()
        print(f'✅ Node registered: UUID={uuid_hex} Addr=0x{mesh_addr:04x}')
        print(f'🌱 Zone created: {zone_name} (ID={zone_id}) linked to {node_name}')
    except Exception as e:
        print(f'❌ DB Error registering node: {e}')
    finally:
        conn.close()

def update_status(status_data):
    """Write current status to JSON file for Node.js server to read"""
    try:
        with open(STATUS_FILE, 'w') as f:
            json.dump(status_data, f, indent=2)
    except Exception as e:
        print(f'⚠️  Status file error: {e}')

# --- Token Management ---
def save_token(new_token):
    global token
    token = new_token
    with open(TOKEN_FILE, 'wb') as f:
        f.write(struct.pack('<Q', token))
    print(f'🔑 Token saved: {token}')

def load_token():
    global token
    if os.path.exists(TOKEN_FILE):
        with open(TOKEN_FILE, 'rb') as f:
            data = f.read()
            if len(data) == 8:
                token = struct.unpack('<Q', data)[0]
                print(f'🔑 Token loaded: {token}')
                return True
    return False

# --- Parse Sensor Data from Mesh Message ---
def parse_sensor_message(data):
    """
    Parse custom sensor data packet from ESP32 node.
    Protocol (12 bytes):
      [0-1]  temperature (int16, x100)  e.g. 2750 = 27.50°C
      [2-3]  humidity    (uint16, x100) e.g. 6500 = 65.00%
      [4-5]  light       (uint16)       raw lux value
      [6-7]  soil_moisture (uint16, x100) e.g. 4520 = 45.20%
      [8-11] reserved
    """
    if len(data) < 8:
        print(f'⚠️  Short message ({len(data)} bytes), skipping')
        return None

    try:
        temp_raw = struct.unpack('<h', bytes(data[0:2]))[0]
        hum_raw = struct.unpack('<H', bytes(data[2:4]))[0]
        light_raw = struct.unpack('<H', bytes(data[4:6]))[0]
        soil_raw = struct.unpack('<H', bytes(data[6:8]))[0]

        return {
            'temperature': round(temp_raw / 100.0, 1),
            'humidity': round(hum_raw / 100.0, 1),
            'light': light_raw,
            'soil_moisture': round(soil_raw / 100.0, 1)
        }
    except Exception as e:
        print(f'⚠️  Parse error: {e}')
        return None


# --- D-Bus Application classes ---

class Application(dbus.service.Object):
    """BLE Mesh Application - registered with BlueZ mesh daemon"""

    def __init__(self, bus):
        self.path = MESH_APP_PATH
        self.elements = []
        self.provisioner = None
        self.agent = None
        dbus.service.Object.__init__(self, bus, self.path)

    def get_path(self):
        return dbus.ObjectPath(self.path)

    def add_element(self, element):
        self.elements.append(element)

    def set_provisioner(self, provisioner):
        self.provisioner = provisioner

    def set_agent(self, agent):
        self.agent = agent

    @dbus.service.method(DBUS_OM_IFACE, out_signature='a{oa{sa{sv}}}')
    def GetManagedObjects(self):
        response = {}

        # Application interface
        response[self.path] = {
            MESH_APPLICATION_IFACE: {
                'CompanyID': dbus.UInt16(VENDOR_ID),
                'ProductID': dbus.UInt16(0x0001),
                'VersionID': dbus.UInt16(0x0001),
            }
        }

        # Elements
        for element in self.elements:
            elem_props = element.get_properties()
            response[element.get_path()] = {
                MESH_ELEMENT_IFACE: elem_props
            }

        # Provisioner
        if self.provisioner:
            prov_props = self.provisioner.get_properties()
            response[self.provisioner.get_path()] = {
                MESH_PROVISIONER_IFACE: prov_props
            }

        # Agent
        if self.agent:
            agent_props = self.agent.get_properties()
            response[self.agent.get_path()] = {
                MESH_PROVISION_AGENT_IFACE: agent_props
            }

        return response

    @dbus.service.method(MESH_APPLICATION_IFACE, in_signature='t', out_signature='')
    def JoinComplete(self, token_val):
        print(f'🎉 Network joined! Token: {token_val}')
        save_token(token_val)
        update_status({'state': 'joined', 'token': token_val, 'timestamp': time.time()})

    @dbus.service.method(MESH_APPLICATION_IFACE, in_signature='s', out_signature='')
    def JoinFailed(self, reason):
        print(f'❌ Join failed: {reason}')
        update_status({'state': 'join_failed', 'reason': reason, 'timestamp': time.time()})


class Element(dbus.service.Object):
    """BLE Mesh Element - receives messages from nodes"""

    def __init__(self, bus, index):
        self.path = f'{MESH_APP_PATH}/element{index}'
        self.index = index
        self.models = []
        self.vendor_models = []
        dbus.service.Object.__init__(self, bus, self.path)

    def get_path(self):
        return dbus.ObjectPath(self.path)

    def get_properties(self):
        props = {
            'Index': dbus.Byte(self.index),
            'Models': dbus.Array(self.models, signature='q'),
            'VendorModels': dbus.Array(self.vendor_models, signature='(qq)'),
        }
        return props

    @dbus.service.method(MESH_ELEMENT_IFACE, in_signature='qqvay', out_signature='')
    def MessageReceived(self, source, key_index, destination, data):
        """Called when a mesh message arrives from an ESP32 node"""
        data_bytes = bytes(data)
        print(f'📨 Message from 0x{source:04x} (key={key_index}, dest=0x{destination:04x}): {data_bytes.hex()}')

        sensor_data = parse_sensor_message(data_bytes)
        if sensor_data:
            save_sensor_data(
                source,
                sensor_data['temperature'],
                sensor_data['humidity'],
                sensor_data['light'],
                sensor_data['soil_moisture']
            )

    @dbus.service.method(MESH_ELEMENT_IFACE, in_signature='qa{sv}', out_signature='')
    def UpdateModelConfiguration(self, model_id, config):
        print(f'🔧 Model 0x{model_id:04x} config updated: {config}')

    @dbus.service.method(MESH_ELEMENT_IFACE, in_signature='qqbay', out_signature='')
    def DevKeyMessageReceived(self, source, remote, is_level2, data):
        print(f'🔐 DevKey message from 0x{source:04x}: {bytes(data).hex()}')


class Provisioner(dbus.service.Object):
    """Provisioner - handles adding new ESP32 nodes to the mesh network"""

    def __init__(self, bus):
        self.path = MESH_APP_PATH + '/provisioner'
        dbus.service.Object.__init__(self, bus, self.path)
        self.next_addr = 0x0002  # Starting address for new nodes (0x0001 is Pi itself)

    def get_path(self):
        return dbus.ObjectPath(self.path)

    def get_properties(self):
        return {}

    @dbus.service.method(MESH_PROVISIONER_IFACE, in_signature='nay', out_signature='')
    def ScanResult(self, rssi, data):
        """Called when an unprovisioned device is discovered"""
        uuid_hex = bytes(data).hex()
        print(f'🔍 Unprovisioned device found: UUID={uuid_hex} RSSI={rssi}')
        update_status({
            'state': 'device_found',
            'uuid': uuid_hex,
            'rssi': rssi,
            'timestamp': time.time()
        })

    @dbus.service.method(MESH_PROVISIONER_IFACE, in_signature='y', out_signature='qq')
    def RequestProvData(self, count):
        """Assign network address to newly provisioned node"""
        addr = self.next_addr
        self.next_addr += 1
        print(f'📋 Provisioning: assigning address 0x{addr:04x} (elements: {count})')
        return dbus.UInt16(0), dbus.UInt16(addr)  # (net_index, unicast_address)

    @dbus.service.method(MESH_PROVISIONER_IFACE, in_signature='ayqy', out_signature='')
    def AddNodeComplete(self, uuid, unicast, count):
        """Called when a node is successfully provisioned"""
        uuid_hex = bytes(uuid).hex()
        print(f'✅ Node provisioned! UUID={uuid_hex} Address=0x{unicast:04x} Elements={count}')
        register_new_node(uuid_hex, unicast)
        update_status({
            'state': 'node_provisioned',
            'uuid': uuid_hex,
            'address': hex(unicast),
            'timestamp': time.time()
        })

    @dbus.service.method(MESH_PROVISIONER_IFACE, in_signature='ays', out_signature='')
    def AddNodeFailed(self, uuid, reason):
        uuid_hex = bytes(uuid).hex()
        print(f'❌ Provisioning failed: UUID={uuid_hex} Reason={reason}')
        update_status({
            'state': 'provision_failed',
            'uuid': uuid_hex,
            'reason': reason,
            'timestamp': time.time()
        })


class ProvisionAgent(dbus.service.Object):
    """Agent for OOB (Out-of-Band) authentication during provisioning"""

    def __init__(self, bus):
        self.path = MESH_APP_PATH + '/agent'
        dbus.service.Object.__init__(self, bus, self.path)

    def get_path(self):
        return dbus.ObjectPath(self.path)

    def get_properties(self):
        return {
            'Capabilities': dbus.Array(['out-numeric'], signature='s'),
        }

    @dbus.service.method(MESH_PROVISION_AGENT_IFACE, in_signature='', out_signature='u')
    def DisplayNumeric(self):
        return dbus.UInt32(0)


# --- Main Gateway Logic ---

def attach_callback(node_path, dict_array):
    """Called after successful Attach to mesh network"""
    global node, node_mgr
    print(f'🔗 Attached to mesh: {node_path}')

    obj = bus.get_object(BLUEZ_MESH_SERVICE, node_path)
    node = dbus.Interface(obj, MESH_NODE_IFACE)
    node_mgr = dbus.Interface(obj, MESH_MANAGEMENT_IFACE)

    update_status({
        'state': 'attached',
        'node_path': str(node_path),
        'timestamp': time.time()
    })

    # Start scanning for unprovisioned devices
    try:
        node_mgr.UnprovisionedScan(dbus.UInt16(30))  # scan 30 seconds
        print('🔍 Scanning for unprovisioned BLE Mesh devices...')
    except Exception as e:
        print(f'⚠️  Scan start failed: {e}')

def attach_error(error):
    print(f'❌ Attach failed: {error}')
    update_status({'state': 'attach_failed', 'error': str(error), 'timestamp': time.time()})

def join_callback():
    print('🔗 Join callback...')

def join_error(error):
    print(f'❌ Join error: {error}')
    update_status({'state': 'join_error', 'error': str(error), 'timestamp': time.time()})

def setup_mesh():
    """Initialize the BLE Mesh gateway"""
    global bus, mesh_net, app, mainloop

    dbus.mainloop.glib.DBusGMainLoop(set_as_default=True)
    bus = dbus.SystemBus()

    # Get mesh network interface
    mesh_obj = bus.get_object(BLUEZ_MESH_SERVICE, '/org/bluez/mesh')
    mesh_net = dbus.Interface(mesh_obj, MESH_NETWORK_IFACE)

    # Create application
    app = Application(bus)

    # Create element with sensor models
    element0 = Element(bus, 0)
    element0.models = [
        dbus.UInt16(SENSOR_CLIENT_MODEL_ID),  # We are the client (receiver)
        dbus.UInt16(0x0001),  # Generic OnOff Client (for relay control)
    ]
    element0.vendor_models = [
        (dbus.UInt16(VENDOR_ID), dbus.UInt16(VENDOR_MODEL_ID)),
    ]
    app.add_element(element0)

    # Create provisioner
    provisioner = Provisioner(bus)
    app.set_provisioner(provisioner)

    # Create agent
    agent = ProvisionAgent(bus)
    app.set_agent(agent)

    # Try to attach with existing token, or join as new
    if load_token():
        print(f'🔗 Attaching to existing mesh network (token={token})...')
        mesh_net.Attach(
            app.get_path(),
            dbus.UInt64(token),
            reply_handler=attach_callback,
            error_handler=attach_error
        )
    else:
        print('🆕 Creating new mesh network (first run)...')
        mesh_net.Join(
            app.get_path(),
            dbus.Array(b'\0' * 16, signature='y'),  # Random UUID
            reply_handler=join_callback,
            error_handler=join_error
        )

    update_status({
        'state': 'starting',
        'bluetooth_mac': 'E4:5F:01:0B:99:87',
        'timestamp': time.time()
    })

    print('🚀 BLE Mesh Gateway started! Waiting for mesh events...')


def main():
    global mainloop

    print('=' * 60)
    print('  🌱 Smart Plant - BLE Mesh Gateway (Raspberry Pi 4)')
    print('  Using built-in Bluetooth 5.0 chip')
    print('=' * 60)

    # Check if bluetooth-mesh daemon is running
    result = subprocess.run(['systemctl', 'is-active', 'bluetooth-mesh'], capture_output=True, text=True)
    if result.stdout.strip() != 'active':
        print('⚠️  bluetooth-mesh service is not active. Trying to start...')
        subprocess.run(['sudo', 'systemctl', 'start', 'bluetooth-mesh'], check=False)
        time.sleep(2)
        result = subprocess.run(['systemctl', 'is-active', 'bluetooth-mesh'], capture_output=True, text=True)
        if result.stdout.strip() != 'active':
            print('❌ Could not start bluetooth-mesh service!')
            print('   Run: sudo apt install bluez-meshd && sudo systemctl enable bluetooth-mesh')
            update_status({
                'state': 'error',
                'error': 'bluetooth-mesh service not available',
                'timestamp': time.time()
            })
            sys.exit(1)

    try:
        setup_mesh()
    except dbus.exceptions.DBusException as e:
        print(f'❌ D-Bus Error: {e}')
        print('   Make sure bluetooth-mesh daemon is running:')
        print('   sudo systemctl start bluetooth-mesh')
        update_status({'state': 'error', 'error': str(e), 'timestamp': time.time()})
        sys.exit(1)

    mainloop = GLib.MainLoop()

    try:
        mainloop.run()
    except KeyboardInterrupt:
        print('\n🛑 Gateway shutting down...')
        update_status({'state': 'stopped', 'timestamp': time.time()})
        mainloop.quit()


if __name__ == '__main__':
    main()
