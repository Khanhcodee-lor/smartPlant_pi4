"""Smart Plant vendor wire format and Bluetooth Mesh configuration messages."""
import struct

COMPANY_ID = 0x05F1  # Existing project value; use your assigned Company ID in production.
MODEL_ID = 0x0001
APP_INDEX = 0
NET_INDEX = 0
PI_ADDRESS = 1
SENSOR_OPCODE = b'\xc1' + struct.pack('<H', COMPANY_ID)
MODEL = struct.pack('<HH', COMPANY_ID, MODEL_ID)


def sensor_message(data):
    data = bytes(data)
    if len(data) not in (11, 15) or data[:3] != SENSOR_OPCODE:
        return None
    temperature, humidity, light, soil = struct.unpack('<hHHH', data[3:11])
    if humidity > 10000 or soil > 10000:
        return None
    return dict(temperature=temperature / 100, humidity=humidity / 100,
                light=light, soil_moisture=soil / 100)


def vendor_elements(data, primary, count):
    """Parse Composition Data Status page 0, validating the entire composition."""
    if len(data) < 12 or data[:2] != b'\x02\x00':
        raise ValueError('Invalid composition page 0')
    offset, elements, matches = 12, 0, []
    while offset < len(data):
        if offset + 4 > len(data):
            raise ValueError('Truncated element header')
        _, sig_count, vendor_count = struct.unpack_from('<HBB', data, offset)
        offset += 4
        end = offset + sig_count * 2 + vendor_count * 4
        if end > len(data):
            raise ValueError('Truncated model list')
        for pos in range(offset + sig_count * 2, end, 4):
            if data[pos:pos + 4] == MODEL:
                matches.append(primary + elements)
        offset = end
        elements += 1
    if elements != count:
        raise ValueError('Composition element count differs from provisioning')
    if not matches:
        raise ValueError('ESP does not expose Smart Plant vendor model 05f1:0001')
    return matches


def bind_request(element):
    return b'\x80\x3d' + struct.pack('<HH', element, APP_INDEX) + MODEL


def publication_request(element):
    # Unicast to Pi, AppKey 0, TTL 5, period 0 (firmware sends), retransmit 0.
    return b'\x03' + struct.pack('<HHHBBB', element, PI_ADDRESS, APP_INDEX, 5, 0, 0) + MODEL


def expected_status(kind, data, element=None):
    """Return status code only for the exact pending operation; ignore unrelated PDUs."""
    if kind == 'appkey' and len(data) == 6 and data[:2] == b'\x80\x03' and data[3:] == b'\0\0\0':
        return data[2]
    if kind == 'bind' and len(data) == 11 and data[:2] == b'\x80\x3e' and data[3:] == bind_request(element)[2:]:
        return data[2]
    if kind == 'publication' and len(data) == 16 and data[:2] == b'\x80\x19':
        # Failure replies may carry old publication values; correlate element/model first.
        if data[3:5] == struct.pack('<H', element) and data[12:] == MODEL:
            if data[2] or data[3:] == publication_request(element)[1:]:
                return data[2]
    return None
