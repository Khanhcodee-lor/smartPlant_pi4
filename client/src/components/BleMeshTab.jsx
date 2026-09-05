import { useState, useEffect } from 'react';
import { Bluetooth, RefreshCw, Radio, Cpu, MapPin, Trash2, CheckCircle2, AlertCircle, Zap, Circle } from 'lucide-react';
import { getBleStatus, getBleNodes, scanBleDevices, assignNodeToZone, removeBleNode, fetchZones } from '../api';

export default function BleMeshTab() {
  const [status, setStatus] = useState({ state: 'not_started' });
  const [nodes, setNodes] = useState([]);
  const [zones, setZones] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [successMsg, setSuccessMsg] = useState('');

  const loadData = async () => {
    setLoading(true);
    setError('');
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

  useEffect(() => {
    loadData();
    const interval = setInterval(loadData, 10000); // Refresh every 10s
    return () => clearInterval(interval);
  }, []);



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
    if (!confirm('Bạn có chắc muốn xóa Node này?')) return;
    try {
      await removeBleNode(nodeId);
      setSuccessMsg('Đã xóa Node.');
      loadData();
    } catch (err) {
      setError('Lỗi khi xóa Node.');
    }
  };

  const getStateColor = (state) => {
    const colors = {
      'attached': 'emerald',
      'joined': 'emerald',
      'starting': 'amber',
      'device_found': 'cyan',
      'node_provisioned': 'emerald',
      'not_started': 'slate',
      'error': 'red',
      'stopped': 'red',
    };
    return colors[state] || 'slate';
  };

  const getStateLabel = (state) => {
    const labels = {
      'attached': 'Đã kết nối mạng Mesh',
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

  return (
    <div className="space-y-6 animate-fade-in-up">
      <div className="flex items-center justify-between px-2">
        <div>
          <h2 className="text-2xl font-display font-bold text-slate-900 tracking-tight">BLE Mesh Network</h2>
          <p className="text-sm text-slate-500 mt-1">Quản lý mạng lưới cảm biến ESP32 không dây</p>
        </div>
        <div className="flex gap-2">

          <button
            onClick={loadData}
            disabled={loading}
            className="flex items-center gap-2 px-4 py-2 bg-white border border-slate-200 rounded-xl shadow-sm text-sm font-medium text-slate-700 hover:bg-slate-50 transition-colors disabled:opacity-50"
          >
            <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} />
            Làm mới
          </button>
        </div>
      </div>

      {error && (
        <div className="p-3 bg-red-50 text-red-600 text-sm rounded-xl flex items-start gap-2">
          <AlertCircle className="w-4 h-4 mt-0.5 shrink-0" />
          <p>{error}</p>
        </div>
      )}

      {successMsg && (
        <div className="p-3 bg-emerald-50 text-emerald-600 text-sm rounded-xl flex items-start gap-2">
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
            <div className={`flex items-center gap-3 p-4 rounded-xl border bg-${getStateColor(status.state)}-50/50 border-${getStateColor(status.state)}-100`}>
              <div className={`w-3 h-3 rounded-full ${status.state === 'attached' || status.state === 'joined' ? 'bg-emerald-500 animate-pulse' : status.state === 'starting' ? 'bg-amber-500 animate-pulse' : 'bg-slate-400'}`} />
              <div>
                <p className="font-semibold text-slate-900 text-sm">{getStateLabel(status.state)}</p>
                <p className="text-xs text-slate-500">Chip: Bluetooth 5.0 (Pi4 Internal)</p>
              </div>
            </div>
            {status.bluetooth_mac && (
              <p className="text-xs text-slate-500 font-mono px-1">MAC: {status.bluetooth_mac}</p>
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
              <p className="text-3xl font-bold text-emerald-600">{nodes.filter(n => n.status === 'active' || n.status === 'provisioned').length}</p>
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
            <p className="text-sm mt-1">Hệ thống sẽ tự động phát hiện và thêm Node khi bạn bật nguồn ESP32.</p>
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
                      <div className="flex items-center gap-2">
                        <Cpu className="w-4 h-4 text-slate-400" />
                        {node.name || `Node-${node.id}`}
                      </div>
                    </td>
                    <td className="py-3 font-mono text-xs text-slate-600">{node.mesh_address || '---'}</td>
                    <td className="py-3">
                      <span className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-medium ${
                        node.status === 'active' ? 'bg-emerald-100 text-emerald-700' :
                        node.status === 'provisioned' ? 'bg-blue-100 text-blue-700' :
                        'bg-slate-100 text-slate-600'
                      }`}>
                        <Circle className={`w-2 h-2 fill-current ${node.status === 'active' ? 'animate-pulse' : ''}`} />
                        {node.status === 'active' ? 'Hoạt động' : node.status === 'provisioned' ? 'Đã cấp phát' : node.status}
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
                      <button
                        onClick={() => handleRemove(node.id)}
                        className="p-1.5 text-slate-400 hover:text-red-500 hover:bg-red-50 rounded-lg transition-colors"
                        title="Xóa Node"
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
