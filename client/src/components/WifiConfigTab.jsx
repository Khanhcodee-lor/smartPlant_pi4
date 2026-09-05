import { useState, useEffect } from 'react';
import { Wifi, RefreshCw, Lock, CheckCircle2, AlertCircle } from 'lucide-react';
import { scanWifi, getWifiStatus, connectWifi } from '../api';

export default function WifiConfigTab() {
  const [networks, setNetworks] = useState([]);
  const [currentWifi, setCurrentWifi] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [selectedSsid, setSelectedSsid] = useState('');
  const [password, setPassword] = useState('');
  const [connecting, setConnecting] = useState(false);
  const [successMsg, setSuccessMsg] = useState('');

  const loadData = async () => {
    setLoading(true);
    setError('');
    try {
      const [status, nets] = await Promise.all([
        getWifiStatus(),
        scanWifi()
      ]);
      setCurrentWifi(status);
      setNetworks(nets || []);
    } catch (err) {
      setError('Lỗi khi lấy thông tin Wi-Fi. Đảm bảo Server đang chạy.');
      console.error(err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadData();
  }, []);

  const handleConnect = async (e) => {
    e.preventDefault();
    if (!selectedSsid) return;
    
    setConnecting(true);
    setError('');
    setSuccessMsg('');
    
    try {
      const res = await connectWifi(selectedSsid, password);
      setSuccessMsg(`Đã kết nối thành công tới ${selectedSsid}`);
      setPassword('');
      setSelectedSsid('');
      loadData(); // refresh status
    } catch (err) {
      setError(err.message || 'Lỗi khi kết nối tới Wi-Fi.');
    } finally {
      setConnecting(false);
    }
  };

  return (
    <div className="space-y-6 animate-fade-in-up">
      <div className="flex items-center justify-between px-2">
        <div>
          <h2 className="text-2xl font-display font-bold text-slate-900 tracking-tight">Cấu hình Wi-Fi</h2>
          <p className="text-sm text-slate-500 mt-1">Kết nối Raspberry Pi với mạng Wi-Fi mới</p>
        </div>
        <button 
          onClick={loadData}
          disabled={loading}
          className="flex items-center gap-2 px-4 py-2 bg-white border border-slate-200 rounded-xl shadow-sm text-sm font-medium text-slate-700 hover:bg-slate-50 transition-colors disabled:opacity-50"
        >
          <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} />
          Làm mới
        </button>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Left Column: Current Status & Scan Results */}
        <div className="space-y-6">
          <div className="glass-panel p-6 border-emerald-500/20 shadow-[0_4px_20px_rgba(16,185,129,0.05)]">
            <h3 className="text-lg font-semibold text-slate-800 mb-4 flex items-center gap-2">
              <Wifi className="w-5 h-5 text-emerald-500" />
              Mạng hiện tại
            </h3>
            {currentWifi && currentWifi.ssid ? (
              <div className="flex items-center gap-4 bg-emerald-50/50 p-4 rounded-xl border border-emerald-100">
                <div className="w-10 h-10 rounded-full bg-emerald-100 flex items-center justify-center">
                  <CheckCircle2 className="w-5 h-5 text-emerald-600" />
                </div>
                <div>
                  <p className="font-semibold text-slate-900">{currentWifi.ssid}</p>
                  <p className="text-sm text-emerald-600">Đã kết nối</p>
                </div>
              </div>
            ) : (
              <div className="flex items-center gap-3 text-slate-500 bg-slate-50 p-4 rounded-xl border border-slate-100">
                <AlertCircle className="w-5 h-5" />
                <p>Không có kết nối Wi-Fi nào.</p>
              </div>
            )}
          </div>

          <div className="glass-panel p-6">
            <h3 className="text-lg font-semibold text-slate-800 mb-4">Danh sách Wi-Fi ({networks.length})</h3>
            <div className="max-h-[400px] overflow-y-auto custom-scrollbar space-y-2 pr-2">
              {loading ? (
                <p className="text-sm text-slate-500 text-center py-4">Đang quét mạng...</p>
              ) : networks.length === 0 ? (
                <p className="text-sm text-slate-500 text-center py-4">Không tìm thấy mạng Wi-Fi nào.</p>
              ) : (
                networks.map((net, i) => (
                  <button
                    key={i}
                    onClick={() => setSelectedSsid(net.ssid)}
                    className={`w-full text-left flex items-center justify-between p-3 rounded-xl border transition-all ${
                      selectedSsid === net.ssid 
                        ? 'bg-emerald-50 border-emerald-200 shadow-sm' 
                        : 'bg-white border-slate-100 hover:border-slate-200 hover:bg-slate-50'
                    }`}
                  >
                    <div className="flex items-center gap-3">
                      <Wifi className={`w-5 h-5 ${selectedSsid === net.ssid ? 'text-emerald-500' : 'text-slate-400'}`} />
                      <span className="font-medium text-slate-700">{net.ssid}</span>
                    </div>
                    <span className="text-xs text-slate-400">{net.signal_level} dBm</span>
                  </button>
                ))
              )}
            </div>
          </div>
        </div>

        {/* Right Column: Connect Form */}
        <div className="glass-panel p-6 h-fit sticky top-6">
          <h3 className="text-lg font-semibold text-slate-800 mb-6 flex items-center gap-2">
            <Lock className="w-5 h-5 text-slate-400" />
            Kết nối mạng mới
          </h3>

          <form onSubmit={handleConnect} className="space-y-5">
            <div>
              <label className="block text-sm font-medium text-slate-700 mb-1">Tên mạng (SSID)</label>
              <input
                type="text"
                value={selectedSsid}
                onChange={(e) => setSelectedSsid(e.target.value)}
                placeholder="Chọn mạng bên trái hoặc nhập tay"
                className="w-full px-4 py-2.5 rounded-xl border border-slate-200 bg-slate-50 focus:bg-white focus:ring-2 focus:ring-emerald-500/20 focus:border-emerald-500 transition-all text-slate-800"
                required
              />
            </div>
            
            <div>
              <label className="block text-sm font-medium text-slate-700 mb-1">Mật khẩu</label>
              <input
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="Nhập mật khẩu Wi-Fi..."
                className="w-full px-4 py-2.5 rounded-xl border border-slate-200 bg-slate-50 focus:bg-white focus:ring-2 focus:ring-emerald-500/20 focus:border-emerald-500 transition-all text-slate-800"
              />
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

            <button
              type="submit"
              disabled={connecting || !selectedSsid}
              className="w-full py-3 bg-emerald-500 hover:bg-emerald-600 disabled:bg-slate-300 text-white font-medium rounded-xl shadow-md shadow-emerald-500/20 transition-all flex justify-center items-center gap-2"
            >
              {connecting ? (
                <>
                  <RefreshCw className="w-5 h-5 animate-spin" />
                  Đang kết nối...
                </>
              ) : (
                'Kết nối'
              )}
            </button>
            <p className="text-xs text-slate-500 text-center mt-4">
              Lưu ý: Pi có thể mất kết nối mạng hiện tại nếu bạn đổi sang Wi-Fi khác.
            </p>
          </form>
        </div>
      </div>
    </div>
  );
}
