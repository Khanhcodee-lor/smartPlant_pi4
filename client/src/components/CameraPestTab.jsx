import { useState, useEffect } from 'react';
import { Camera, AlertCircle, Video, Play, Maximize2, X } from 'lucide-react';
import { fetchPestHistory } from '../api';

export default function CameraPestTab() {
  const [history, setHistory] = useState([]);
  const [loading, setLoading] = useState(true);
  const [selectedImage, setSelectedImage] = useState(null);

  useEffect(() => {
    async function loadData() {
      const data = await fetchPestHistory(30); // Lấy lịch sử 30 ngày
      setHistory(data);
      setLoading(false);
    }
    loadData();
  }, []);

  const severityConfig = {
    critical: { label: 'Nghiêm trọng', bg: 'bg-rose-100', text: 'text-rose-600', dot: 'bg-rose-500' },
    high: { label: 'Cao', bg: 'bg-orange-100', text: 'text-orange-600', dot: 'bg-orange-500' },
    medium: { label: 'Trung bình', bg: 'bg-amber-100', text: 'text-amber-600', dot: 'bg-amber-500' },
    low: { label: 'Thấp', bg: 'bg-emerald-100', text: 'text-emerald-600', dot: 'bg-emerald-500' },
  };

  const formatTime = (timestamp) => {
    const d = new Date(timestamp);
    return d.toLocaleString('vi-VN', { 
      day: '2-digit', month: '2-digit', year: 'numeric',
      hour: '2-digit', minute: '2-digit' 
    });
  };

  return (
    <div className="space-y-6 animate-fade-in-up">
      {/* Live Camera Section */}
      <section className="glass-panel p-4 sm:p-6">
        <div className="flex items-center justify-between mb-4">
          <div>
            <h2 className="text-xl font-bold text-slate-900 flex items-center gap-2">
              <Camera className="w-5 h-5 text-emerald-600" />
              Live Camera
            </h2>
            <p className="text-sm text-slate-500">Khu vực B - Cà chua (Demo Stream)</p>
          </div>
          <div className="flex items-center gap-2 px-3 py-1 bg-rose-50 text-rose-600 rounded-full border border-rose-200">
            <div className="w-2 h-2 rounded-full bg-rose-500 animate-pulse" />
            <span className="text-xs font-bold uppercase tracking-wider">LIVE</span>
          </div>
        </div>

        <div className="relative aspect-video bg-slate-900 rounded-xl overflow-hidden group">
          {/* Giả lập Camera Stream */}
          <img 
            src="https://images.unsplash.com/photo-1591857177580-dc82b9ac4e1e?q=80&w=1200&auto=format&fit=crop" 
            alt="Live Camera Feed"
            className="w-full h-full object-cover opacity-80 mix-blend-screen"
          />
          <div className="absolute inset-0 bg-gradient-to-t from-slate-900/60 to-transparent pointer-events-none" />
          
          <div className="absolute bottom-4 left-4 right-4 flex items-center justify-between text-white/90">
            <div className="flex items-center gap-2 text-sm font-mono bg-black/40 px-3 py-1.5 rounded-lg backdrop-blur-sm">
              <Video className="w-4 h-4 text-emerald-400" />
              1920x1080 30FPS
            </div>
            <button className="p-2 hover:bg-white/20 rounded-lg backdrop-blur-sm transition-colors">
              <Maximize2 className="w-5 h-5" />
            </button>
          </div>
          
          {/* Nút giả lập phát lại */}
          <div className="absolute inset-0 flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity">
            <button className="w-16 h-16 rounded-full bg-emerald-500/80 text-white flex items-center justify-center backdrop-blur-md hover:scale-110 transition-transform">
              <Play className="w-8 h-8 ml-1" />
            </button>
          </div>
        </div>
      </section>

      {/* Pest History Gallery */}
      <section>
        <div className="flex items-center justify-between mb-4 px-2">
          <div>
            <h2 className="text-xl font-bold text-slate-900">Lịch sử bệnh hại</h2>
            <p className="text-sm text-slate-500">Hình ảnh lưu trữ từ hệ thống AI</p>
          </div>
        </div>

        {loading ? (
          <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-4 gap-4 animate-pulse">
            {[1,2,3,4].map(i => <div key={i} className="h-48 bg-slate-200/60 rounded-xl" />)}
          </div>
        ) : history.length === 0 ? (
          <div className="glass-panel p-8 text-center text-slate-500">
            Không có dữ liệu lịch sử nào.
          </div>
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-4">
            {history.map((item) => {
              const sev = severityConfig[item.severity] || severityConfig.low;
              const hasImage = !!item.image_path;

              return (
                <div key={item.id} className="glass-panel overflow-hidden group hover:shadow-md transition-shadow">
                  <div 
                    className="relative h-40 bg-slate-100 cursor-pointer overflow-hidden"
                    onClick={() => hasImage && setSelectedImage(item.image_path)}
                  >
                    {hasImage ? (
                      <img 
                        src={item.image_path} 
                        alt={item.pest_type}
                        className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-500"
                      />
                    ) : (
                      <div className="w-full h-full flex flex-col items-center justify-center text-slate-400">
                        <AlertCircle className="w-8 h-8 mb-2 opacity-50" />
                        <span className="text-xs">Không có ảnh</span>
                      </div>
                    )}
                    
                    <div className="absolute top-2 right-2">
                      <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded text-[10px] font-bold uppercase tracking-wider shadow-sm ${sev.bg} ${sev.text}`}>
                        <span className={`w-1.5 h-1.5 rounded-full ${sev.dot}`} />
                        {sev.label}
                      </span>
                    </div>
                  </div>

                  <div className="p-3">
                    <h3 className="text-sm font-bold text-slate-900">{item.pest_type}</h3>
                    <div className="flex items-center justify-between mt-1 text-xs text-slate-500">
                      <span>{item.zone_name || 'Khu vực không rõ'}</span>
                      <span className="font-semibold text-emerald-600">{(item.confidence * 100).toFixed(0)}%</span>
                    </div>
                    <p className="text-[10px] text-slate-400 mt-2">{formatTime(item.timestamp)}</p>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </section>

      {/* Image Modal */}
      {selectedImage && (
        <div 
          className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/80 backdrop-blur-sm p-4 animate-fade-in-up"
          onClick={() => setSelectedImage(null)}
        >
          <div className="relative max-w-4xl w-full">
            <button 
              className="absolute -top-12 right-0 p-2 text-white/70 hover:text-white transition-colors"
              onClick={() => setSelectedImage(null)}
            >
              <X className="w-8 h-8" />
            </button>
            <img 
              src={selectedImage} 
              alt="Phóng to"
              className="w-full h-auto max-h-[80vh] object-contain rounded-xl shadow-2xl ring-1 ring-white/10"
              onClick={(e) => e.stopPropagation()}
            />
          </div>
        </div>
      )}
    </div>
  );
}
