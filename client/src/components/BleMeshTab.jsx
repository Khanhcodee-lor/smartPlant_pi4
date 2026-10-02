import { useState, useEffect } from 'react';
import { Bluetooth, RefreshCw, Radio, Cpu, Trash2, CheckCircle2, AlertCircle, Zap, Circle, Search, PlusCircle, Settings2, Edit2, Check, X } from 'lucide-react';
import { getBleStatus, getBleNodes, scanBleDevices, provisionBleDevice, configureBleDevice, assignNodeToZone, updateBleNodeName, removeBleNode, fetchZones } from '../api';

export default function BleMeshTab() {
  const [status, setStatus] = useState({ state: 'not_started' });
  const [nodes, setNodes] = useState([]);
  const [zones, setZones] = useState([]);
  const [loading, setLoading] = useState(false);
  const [actionPending, setActionPending] = useState('');
  const [uuidInput, setUuidInput] = useState('');
  const [error, setError] = useState('');
  const [successMsg, setSuccessMsg] = useState('');
  const [editingNodeId, setEditingNodeId] = useState(null);
  const [editingName, setEditingName] = useState('');

  const isNodeOnline = (node) => {
    if (node.status !== 'active' || !node.last_seen) return false;
    const iso = node.last_seen.replace(' ', 'T');
    return Date.now() - Date.parse(iso.endsWith('Z') ? iso : iso + 'Z') < 30000;
  };
  const discoveredDevices = status.devices || [];
  const normalizedUuid = normalizeUuid(uuidInput);
  const selectedDevice = discoveredDevices.find((device) => normalizeUuid(device.uuid) === normalizedUuid);
  const existingNode = nodes.find((node) => normalizeUuid(node.uuid) === normalizedUuid);
  const uuidIsValid = /^53504d31[0-9a-f]{24}$/.test(normalizedUuid);
  const gatewayBusy = ['provisioning', 'configuring', 'removing'].includes(status.state);
  const canSubmitJoin = status.ready && uuidIsValid && !actionPending && !gatewayBusy;

  const loadData = async (silent = false) => {
    if (!silent) setLoading(true);
    try {
      const [bleStatus, bleNodes, allZones] = await Promise.all([
        getBleStatus(),
        getBleNodes(),
        fetchZones()
      ]);
      setStatus(bleStatus);
      setNodes(bleNodes);
      setZones(allZones);
    } catch (err) {
      setError('Lỗi khi lấy thông tin BLE Mesh.');
      console.error(err);
    } finally {
      setLoading(false);
    }
  };

  function normalizeUuid(value = '') {
    return value.trim().replace(/[\s:-]/g, '').toLowerCase();
  }

  useEffect(() => {
    loadData();
    const interval = setInterval(() => loadData(true), 2000); // Show scan results and provisioning progress promptly
    return () => clearInterval(interval);
  }, []);

  const handleMeshCommand = async (command, successText, actionKey = 'command') => {
    setError('');
    setSuccessMsg('');
    setActionPending(actionKey);
    try {
      await command();
      await loadData();
      setSuccessMsg(successText || 'Đã nhận yêu cầu. Xem trạng thái gateway để biết kết quả.');
    } catch (err) {
      setError(err.message);
    } finally {
      setActionPending('');
    }
  };

  const handleScan = () => {
    handleMeshCommand(
      scanBleDevices,
      'Đã bắt đầu quét ESP32 chưa provision.',
      'scan'
    );
  };

  const handleJoinSubmit = (event) => {
    event.preventDefault();
    setError('');
    setSuccessMsg('');

    if (!uuidIsValid) {
      setError('UUID phải gồm 32 ký tự hex và bắt đầu bằng 53504d31 (SPM1).');
      return;
    }

    if (!status.ready) {
      setError('ESP32 Mesh Gateway nối USB chưa sẵn sàng.');
      return;
    }

    if (!existingNode && !selectedDevice) {
      setError('UUID chưa có trong kết quả quét. Nhấn Quét ESP32 trước khi join.');
      return;
    }

    const command = existingNode
      ? () => configureBleDevice(normalizedUuid)
      : () => provisionBleDevice(normalizedUuid);

    handleMeshCommand(
      command,
      existingNode ? 'Đã gửi yêu cầu cấu hình lại node.' : 'Đã gửi yêu cầu Join, đang chờ kết quả từ gateway. Node chưa được xác nhận vào mạng.',
      existingNode ? 'configure' : 'provision'
    );
  };

  const handleAssign = async (nodeId, zoneId) => {
    try {
      await assignNodeToZone(nodeId, zoneId);
      setSuccessMsg('Gán Node vào Zone thành công!');
      loadData();
    } catch (err) {
      setError('Lỗi khi gán Node.');
    }
  };

  const handleRemove = async (nodeId) => {
    if (!confirm('Xóa ESP32 khỏi mạng Mesh và khu của node này? Hãy giữ node bật nguồn để nhận lệnh reset.')) return;
    setActionPending('remove');
    try {
      await removeBleNode(nodeId);
      setSuccessMsg('Đang xóa node khỏi mạng. Chờ ESP32 xác nhận reset.');
      loadData();
    } catch (err) {
      setError(err.message || 'Không thể xóa node.');
    } finally { setActionPending(''); }
  };

  const startRename = (node) => {
    setEditingNodeId(node.id);
    setEditingName(node.name || `node${node.id}`);
  };

  const handleSaveRename = async (nodeId) => {
    if (!editingName.trim()) return;
    try {
      await updateBleNodeName(nodeId, editingName.trim());
      await loadData(true);
      setEditingNodeId(null);
      setSuccessMsg(`Đã đổi tên node thành "${editingName.trim()}"`);
    } catch (err) {
      setError(err.message);
    }
  };

  const getStateLabel = (state) => {
    const labels = {
      'removing': 'Đang xóa node khỏi mạng',
      'remove_failed': 'Xóa thất bại — kiểm tra nguồn node rồi thử lại',
      'scanning': 'Đang quét thiết bị',
      'provisioning': 'Đang cấp mạng cho ESP',
      'configuring': 'Đang cấu hình model',
      'node_configured': 'Node đã sẵn sàng gửi dữ liệu',
      'configuration_failed': 'Cấu hình thất bại',
      'provision_failed': 'Cấp mạng thất bại',
      'scan_failed': 'Quét thất bại',
      'attached': 'ESP32 Gateway đã sẵn sàng',
      'connecting': 'Đang kết nối ESP32 qua USB',
      'disconnected': 'Chưa thấy ESP32 Gateway',
      'joined': 'Đã tham gia mạng',
      'starting': 'Đang khởi động...',
      'device_found': 'Phát hiện thiết bị mới',
      'node_provisioned': 'Vừa cấp phát Node mới',
      'not_started': 'Chưa khởi động',
      'error': 'Lỗi',
      'stopped': 'Đã dừng',
    };
    return labels[state] || state;
  };

  const getStateTone = (state) => {
    const tones = {
      removing: { card: 'bg-amber-50/50 border-amber-100', dot: 'bg-amber-500 animate-pulse' },
      remove_failed: { card: 'bg-red-50/50 border-red-100', dot: 'bg-red-500' },
      scanning: {
        card: 'bg-cyan-50/50 border-cyan-100',
        dot: 'bg-cyan-500 animate-pulse',
      },
      provisioning: {
        card: 'bg-blue-50/50 border-blue-100',
        dot: 'bg-blue-500 animate-pulse',
      },
      configuring: {
        card: 'bg-amber-50/50 border-amber-100',
        dot: 'bg-amber-500 animate-pulse',
      },
      node_configured: {
        card: 'bg-emerald-50/50 border-emerald-100',
        dot: 'bg-emerald-500 animate-pulse',
      },
      configuration_failed: {
        card: 'bg-red-50/50 border-red-100',
        dot: 'bg-red-500',
      },
      provision_failed: {
        card: 'bg-red-50/50 border-red-100',
        dot: 'bg-red-500',
      },
      scan_failed: {
        card: 'bg-red-50/50 border-red-100',
        dot: 'bg-red-500',
      },
      attached: {
        card: 'bg-emerald-50/50 border-emerald-100',
        dot: 'bg-emerald-500 animate-pulse',
      },
      connecting: {
        card: 'bg-amber-50/50 border-amber-100',
        dot: 'bg-amber-500 animate-pulse',
      },
      disconnected: {
        card: 'bg-red-50/50 border-red-100',
        dot: 'bg-red-500',
      },
      joined: {
        card: 'bg-emerald-50/50 border-emerald-100',
        dot: 'bg-emerald-500 animate-pulse',
      },
      starting: {
        card: 'bg-amber-50/50 border-amber-100',
        dot: 'bg-amber-500 animate-pulse',
      },
      device_found: {
        card: 'bg-cyan-50/50 border-cyan-100',
        dot: 'bg-cyan-500 animate-pulse',
      },
      node_provisioned: {
        card: 'bg-emerald-50/50 border-emerald-100',
        dot: 'bg-emerald-500 animate-pulse',
      },
      not_started: {
        card: 'bg-slate-50/50 border-slate-100',
        dot: 'bg-slate-400',
      },
      error: {
        card: 'bg-red-50/50 border-red-100',
        dot: 'bg-red-500',
      },
      stopped: {
        card: 'bg-red-50/50 border-red-100',
        dot: 'bg-red-500',
      },
    };
    return tones[state] || { card: 'bg-slate-50/50 border-slate-100', dot: 'bg-slate-400' };
  };

  const formatSeenAt = (seenAt) => {
    if (!seenAt) return '---';
    return new Date(seenAt * 1000).toLocaleTimeString('vi-VN');
  };

  const stateTone = getStateTone(status.state);

  return (
    <div className="space-y-6 animate-fade-in-up">
      <div className="flex items-center justify-between px-2">
        <div>
          <h2 className="text-2xl font-display font-bold text-slate-900 tracking-tight">BLE Mesh Network</h2>
          <p className="text-sm text-slate-500 mt-1">Pi hub quản lý các node cảm biến ESP32</p>
        </div>
        <div className="flex gap-2">
          <button
            onClick={() => loadData()}
            disabled={loading}
            className="flex items-center gap-2 px-4 py-2 bg-white border border-slate-200 rounded-xl shadow-sm text-sm font-medium text-slate-700 hover:bg-slate-50 transition-colors disabled:opacity-50"
          >
            <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} />
            Làm mới
          </button>
        </div>
      </div>

      <div className="glass-panel p-6">
        <form onSubmit={handleJoinSubmit} className="space-y-5">
          <div className="flex flex-col gap-3 lg:flex-row lg:items-end lg:justify-between">
            <div>
              <h3 className="text-lg font-semibold text-slate-800 flex items-center gap-2">
                <PlusCircle className="w-5 h-5 text-blue-500" />
                Join ESP32 vào BLE Mesh
              </h3>
              <p className="text-sm text-slate-500 mt-1">ESP32 Gateway quét và đưa node cảm biến vào mạng.</p>
            </div>
            <button
              type="button"
              onClick={handleScan}
              disabled={!status.ready || !!actionPending || gatewayBusy}
              className="inline-flex items-center justify-center gap-2 px-4 py-2 bg-white border border-slate-200 rounded-xl shadow-sm text-sm font-medium text-slate-700 hover:bg-slate-50 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
            >
              <Search className={`w-4 h-4 ${actionPending === 'scan' ? 'animate-spin' : ''}`} />
              Quét ESP32
            </button>
          </div>

          {!status.ready && (
            <div role="alert" className="rounded-xl border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900">
              <p className="font-semibold">Chưa thể quét vì gateway USB chưa sẵn sàng.</p>
              <p>{status.error || 'Cắm ESP32 gateway vào Raspberry Pi chạy web và chờ kết nối.'}</p>
              <p className="mt-1">Node cảm biến là ESP32 thứ hai, cần được cấp nguồn và có firmware node BLE Mesh.</p>
            </div>
          )}

          <div className="grid grid-cols-1 gap-3 xl:flex xl:items-end">
            <div className="min-w-0 flex-1">
              <label htmlFor="ble-uuid" className="block text-xs font-semibold uppercase tracking-wide text-slate-500 mb-2">
                Device UUID
              </label>
              <input
                id="ble-uuid"
                value={uuidInput}
                onChange={(event) => setUuidInput(event.target.value)}
                placeholder="32 ký tự hex của ESP32"
                autoComplete="off"
                spellCheck="false"
                maxLength={47}
                className="w-full rounded-xl border border-slate-200 bg-white/80 px-4 py-3 font-mono text-sm text-slate-800 outline-none transition-colors placeholder:text-slate-400 focus:border-blue-400 focus:ring-4 focus:ring-blue-100"
              />
            </div>
            <button
              type="submit"
              disabled={!canSubmitJoin}
              className="inline-flex min-h-11 items-center justify-center gap-2 self-end rounded-xl bg-blue-600 px-5 py-3 text-sm font-semibold text-white shadow-sm shadow-blue-500/20 transition-colors hover:bg-blue-700 disabled:bg-slate-300 disabled:shadow-none disabled:cursor-not-allowed"
            >
              {existingNode ? <Settings2 className="w-4 h-4" /> : <PlusCircle className="w-4 h-4" />}
              {existingNode ? 'Cấu hình lại node' : 'Join vào Mesh'}
            </button>
          </div>

          <div className="flex flex-wrap items-center gap-2 text-xs">
            <span className={`inline-flex items-center gap-1.5 rounded-full px-3 py-1 font-medium ${status.ready ? 'bg-emerald-50 text-emerald-700' : 'bg-slate-100 text-slate-500'}`}>
              <Circle className={`w-2 h-2 fill-current ${status.ready ? 'animate-pulse' : ''}`} />
              {status.ready ? 'Gateway sẵn sàng' : 'Gateway chưa sẵn sàng'}
            </span>
            {normalizedUuid && (
              <span className={`rounded-full px-3 py-1 font-medium ${uuidIsValid ? 'bg-blue-50 text-blue-700' : 'bg-red-50 text-red-600'}`}>
                {uuidIsValid ? normalizedUuid : 'UUID chưa hợp lệ'}
              </span>
            )}
            {uuidIsValid && existingNode && (
              <span className="rounded-full bg-emerald-50 px-3 py-1 font-medium text-emerald-700">
                Đã có trong mạng {existingNode.mesh_address || ''}
              </span>
            )}
            {uuidIsValid && !existingNode && selectedDevice && (
              <span className="rounded-full bg-cyan-50 px-3 py-1 font-medium text-cyan-700">
                Đã quét: {selectedDevice.rssi} dBm
              </span>
            )}
            {gatewayBusy && (
              <span className="rounded-full bg-amber-50 px-3 py-1 font-medium text-amber-700">
                Gateway đang bận
              </span>
            )}
          </div>

          <div className="rounded-xl border border-slate-100 bg-slate-50/70 p-3">
            <div className="mb-3 flex items-center justify-between gap-3">
              <p className="text-sm font-semibold text-slate-700">ESP32 vừa quét ({discoveredDevices.length})</p>
              {status.state === 'scanning' && (
                <span className="text-xs font-medium text-cyan-700">Đang quét...</span>
              )}
            </div>
            {discoveredDevices.length === 0 ? (
              <div className="rounded-lg border border-dashed border-slate-200 bg-white/70 px-4 py-5 text-center text-sm text-slate-500">
                {!status.ready
                  ? 'Gateway USB chưa kết nối. Kiểm tra ESP32 gateway đang cắm vào đúng máy Raspberry Pi chạy web.'
                  : status.state === 'scanning'
                    ? 'Đang tìm ESP32 cảm biến chưa vào mạng. Bật nguồn node cảm biến và đặt gần gateway.'
                    : 'Nhấn Quét ESP32 để tìm node cảm biến mới. ESP32 cắm USB là gateway, không xuất hiện trong danh sách này.'}
              </div>
            ) : (
              <div className="grid gap-2">
                {discoveredDevices.map((device) => {
                  const deviceSelected = normalizeUuid(device.uuid) === normalizedUuid;
                  return (
                    <button
                      key={device.uuid}
                      type="button"
                      onClick={() => setUuidInput(device.uuid)}
                      className={`flex flex-col gap-2 rounded-lg border px-3 py-3 text-left transition-colors sm:flex-row sm:items-center sm:justify-between ${
                        deviceSelected
                          ? 'border-blue-200 bg-blue-50 text-blue-900'
                          : 'border-slate-200 bg-white/80 text-slate-700 hover:border-blue-200 hover:bg-white'
                      }`}
                    >
                      <span className="font-mono text-xs break-all">{device.uuid}</span>
                      <span className="flex shrink-0 items-center gap-2 text-xs text-slate-500">
                        <span>{device.rssi} dBm</span>
                        <span>{formatSeenAt(device.seen_at)}</span>
                      </span>
                    </button>
                  );
                })}
              </div>
            )}
          </div>
        </form>
      </div>

      {error && (
        <div className="p-3 bg-red-50 text-red-600 text-sm rounded-xl flex items-start gap-2">
          <AlertCircle className="w-4 h-4 mt-0.5 shrink-0" />
          <p>{error}</p>
        </div>
      )}

      {successMsg && !error && !status.error && !['error', 'provision_failed', 'configuration_failed', 'remove_failed', 'disconnected'].includes(status.state) && (
        <div className="p-3 bg-blue-50 text-blue-700 text-sm rounded-xl flex items-start gap-2">
          <CheckCircle2 className="w-4 h-4 mt-0.5 shrink-0" />
          <p>{successMsg}</p>
        </div>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">

        {/* Gateway Status Card */}
        <div className="glass-panel p-6 border-blue-500/20 shadow-[0_4px_20px_rgba(59,130,246,0.05)]">
          <h3 className="text-lg font-semibold text-slate-800 mb-4 flex items-center gap-2">
            <Bluetooth className="w-5 h-5 text-blue-500" />
            Trạng thái Gateway
          </h3>
          <div className="space-y-4">
            <div className={`flex items-center gap-3 p-4 rounded-xl border ${stateTone.card}`}>
              <div className={`w-3 h-3 rounded-full ${stateTone.dot}`} />
              <div>
                <p className="font-semibold text-slate-900 text-sm">{getStateLabel(status.state)}</p>
                <p className="text-xs text-slate-500">
                  Kết nối: {status.serial_port || 'USB serial chưa kết nối'}
                </p>
              </div>
            </div>
            {status.error && <p className="text-sm text-red-600">{status.error}</p>}
            {status.firmware && (
              <p className="text-xs text-slate-500 font-mono px-1">Firmware: {status.firmware}</p>
            )}
          </div>
        </div>

        {/* Network Stats */}
        <div className="glass-panel p-6">
          <h3 className="text-lg font-semibold text-slate-800 mb-4 flex items-center gap-2">
            <Zap className="w-5 h-5 text-amber-500" />
            Thống kê mạng
          </h3>
          <div className="grid grid-cols-2 gap-4">
            <div className="text-center p-4 bg-slate-50 rounded-xl">
              <p className="text-3xl font-bold text-slate-900">{nodes.length}</p>
              <p className="text-xs text-slate-500 mt-1">Tổng Node</p>
            </div>
            <div className="text-center p-4 bg-emerald-50 rounded-xl">
              <p className="text-3xl font-bold text-emerald-600">{nodes.filter(isNodeOnline).length}</p>
              <p className="text-xs text-slate-500 mt-1">Đang hoạt động</p>
            </div>
          </div>
        </div>
      </div>

      {/* Nodes Table */}
      <div className="glass-panel p-6">
        <h3 className="text-lg font-semibold text-slate-800 mb-4 flex items-center gap-2">
          <Radio className="w-5 h-5 text-cyan-500" />
          Danh sách Node ESP32 ({nodes.length})
        </h3>
        {nodes.length === 0 ? (
          <div className="text-center py-12 text-slate-500">
            <Radio className="w-12 h-12 mx-auto mb-4 text-slate-300" />
            <p className="font-medium">Chưa có Node nào trong mạng Mesh</p>
            <p className="text-sm mt-1">Bật ESP32 có firmware BLE Mesh, nhấn Quét ESP32 rồi chọn UUID để thêm vào mạng.</p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left border-b border-slate-100">
                  <th className="pb-3 font-semibold text-slate-500">Tên</th>
                  <th className="pb-3 font-semibold text-slate-500">Địa chỉ Mesh</th>
                  <th className="pb-3 font-semibold text-slate-500">Trạng thái</th>
                  <th className="pb-3 font-semibold text-slate-500">Khu vực (Zone)</th>
                  <th className="pb-3 font-semibold text-slate-500">Lần cuối</th>
                  <th className="pb-3 font-semibold text-slate-500"></th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-50">
                {nodes.map((node) => (
                  <tr key={node.id} className="hover:bg-slate-50/50 transition-colors">
                    <td className="py-3 font-medium text-slate-800">
                      {editingNodeId === node.id ? (
                        <div className="flex items-center gap-1.5">
                          <input
                            type="text"
                            value={editingName}
                            onChange={(e) => setEditingName(e.target.value)}
                            onKeyDown={(e) => {
                              if (e.key === 'Enter') handleSaveRename(node.id);
                              if (e.key === 'Escape') setEditingNodeId(null);
                            }}
                            className="px-2 py-1 text-sm border border-emerald-400 rounded-lg focus:outline-none focus:ring-1 focus:ring-emerald-500 w-28 bg-white"
                            placeholder="node1..."
                            autoFocus
                          />
                          <button
                            onClick={() => handleSaveRename(node.id)}
                            className="p-1 text-emerald-600 hover:bg-emerald-50 rounded"
                            title="Lưu"
                          >
                            <Check className="w-4 h-4" />
                          </button>
                          <button
                            onClick={() => setEditingNodeId(null)}
                            className="p-1 text-slate-400 hover:bg-slate-100 rounded"
                            title="Hủy"
                          >
                            <X className="w-4 h-4" />
                          </button>
                        </div>
                      ) : (
                        <div className="flex items-center gap-2 group">
                          <Cpu className="w-4 h-4 text-slate-400" />
                          <span className="font-semibold text-slate-800">{node.name || `Node-${node.id}`}</span>
                          <button
                            onClick={() => startRename(node)}
                            className="opacity-0 group-hover:opacity-100 p-1 text-slate-400 hover:text-emerald-600 rounded transition-opacity"
                            title="Đổi tên node (VD: node1, node2)"
                          >
                            <Edit2 className="w-3.5 h-3.5" />
                          </button>
                        </div>
                      )}
                    </td>
                    <td className="py-3 font-mono text-xs text-slate-600">{node.mesh_address || '---'}</td>
                    <td className="py-3">
                      <span className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-medium ${
                        isNodeOnline(node) ? 'bg-emerald-100 text-emerald-700' :
                        node.status === 'provisioned' ? 'bg-blue-100 text-blue-700' :
                        'bg-slate-100 text-slate-600'
                      }`}>
                        <Circle className={`w-2 h-2 fill-current ${isNodeOnline(node) ? 'animate-pulse' : ''}`} />
                        {isNodeOnline(node) ? 'Hoạt động' : node.status === 'provisioned' ? 'Chưa cấu hình xong' : node.status === 'configured' ? 'Chờ dữ liệu' : 'Mất kết nối'}
                      </span>
                    </td>
                    <td className="py-3">
                      <select
                        value={node.zone_id || ''}
                        onChange={(e) => handleAssign(node.id, e.target.value)}
                        className="px-2 py-1 border border-slate-200 rounded-lg text-sm bg-white"
                      >
                        <option value="">-- Chọn Zone --</option>
                        {zones.map((z) => (
                          <option key={z.id} value={z.id}>{z.name}</option>
                        ))}
                      </select>
                    </td>
                    <td className="py-3 text-xs text-slate-500">
                      {node.last_seen ? new Date(node.last_seen).toLocaleString('vi-VN') : '---'}
                    </td>
                    <td className="py-3">
                      <button onClick={() => handleMeshCommand(() => configureBleDevice(node.uuid))}
                        disabled={!status.ready || !!actionPending || gatewayBusy}
                        className="text-xs text-blue-600 mr-2 disabled:opacity-50">Cấu hình lại</button>
                      <button
                        onClick={() => handleRemove(node.id)}
                        disabled={!status.ready || !!actionPending || gatewayBusy}
                        className="p-1.5 text-slate-400 hover:text-red-500 hover:bg-red-50 rounded-lg transition-colors"
                        title="Xóa node khỏi mạng Mesh"
                      >
                        <Trash2 className="w-4 h-4" />
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
