import { useState, useEffect, useRef } from 'react';
import { Camera, AlertCircle, Video, Maximize2, X, FolderOpen, Upload, RefreshCw, CheckCircle2, Sparkles, Loader2 } from 'lucide-react';
import { fetchPestHistory, fetchTestImages, uploadTestImage, analyzeImage, clearPestHistory, captureAndAnalyze } from '../api';
import { Trash2 } from 'lucide-react';

export default function CameraPestTab() {
  const [history, setHistory] = useState([]);
  const [loading, setLoading] = useState(true);
  const [selectedImage, setSelectedImage] = useState(null);
  const [testImages, setTestImages] = useState([]);
  const [showTestModal, setShowTestModal] = useState(false);
  const [activeTestImage, setActiveTestImage] = useState(null);
  const [uploading, setUploading] = useState(false);
  const [analyzing, setAnalyzing] = useState(false);
  const [analysisResult, setAnalysisResult] = useState(null);
  const [captureError, setCaptureError] = useState(null);
  const [refreshKey, setRefreshKey] = useState(Date.now());
  const [isLiveStreamMode, setIsLiveStreamMode] = useState(false);
  const fileInputRef = useRef(null);

  useEffect(() => {
    async function loadData() {
      setLoading(true);
      const [histData, testData] = await Promise.all([
        fetchPestHistory(30),
        fetchTestImages()
      ]);
      setHistory(histData || []);
      setTestImages(testData || []);
      setLoading(false);
    }
    loadData();
  }, [refreshKey]);

  // Auto-refresh lịch sử và ảnh live mỗi 10 giây
  useEffect(() => {
    const interval = setInterval(async () => {
      const histData = await fetchPestHistory(30);
      if (histData) {
        setHistory(histData);
      }
      // Cũng refresh ảnh live detection nếu đang ở chế độ camera
      if (!activeTestImage) {
        setRefreshKey(Date.now());
      }
    }, 10000);
    return () => clearInterval(interval);
  }, [activeTestImage]);

  // Hàm tiện ích: refresh lịch sử sau khi phân tích (có delay nhỏ để DB commit)
  const refreshHistoryAfterAnalysis = async () => {
    await new Promise(r => setTimeout(r, 500)); // chờ DB ghi xong
    const updatedHist = await fetchPestHistory(30);
    setHistory(updatedHist || []);
    setRefreshKey(Date.now());
  };

  // Kích hoạt AI phân tích ảnh ngay lập tức
  const handleSelectAndAnalyze = async (filename, directUrl = null) => {
    setShowTestModal(false);
    setAnalyzing(true);
    setAnalysisResult(null);
    setCaptureError(null);

    const res = await analyzeImage(filename);
    if (res?.success && res?.data) {
      setAnalysisResult(res.data);
      // Hiển thị ảnh đã vẽ bounding box (b64 hoặc url)
      if (res.data.image_b64) {
        setActiveTestImage(res.data.image_b64);
      } else if (res.data.image_path) {
        setActiveTestImage(`${res.data.image_path}?t=${Date.now()}`);
      } else if (directUrl) {
        setActiveTestImage(directUrl);
      }
      // Refresh lịch sử bệnh
      await refreshHistoryAfterAnalysis();
    } else {
      if (directUrl) setActiveTestImage(directUrl);
    }
    setAnalyzing(false);
  };

  const handleFileUpload = (e) => {
    const file = e.target.files?.[0];
    if (!file) return;

    setUploading(true);
    const reader = new FileReader();
    reader.onload = async () => {
      const base64 = reader.result;
      const res = await uploadTestImage(base64, file.name);
      if (res && res.filename) {
        // Tải xong -> phân tích AI ngay lập tức luôn!
        const updated = await fetchTestImages();
        setTestImages(updated || []);
        await handleSelectAndAnalyze(res.filename, res.url);
      }
      setUploading(false);
      alert('Đã tải ảnh lên thành công. Bạn có thể chọn ảnh này để test AI.');
      if (fileInputRef.current) fileInputRef.current.value = '';
    };
    reader.readAsDataURL(file);
  };

  const handleClearHistory = async () => {
    if (window.confirm("Bạn có chắc chắn muốn xóa TOÀN BỘ lịch sử phát hiện bệnh không? Hành động này không thể hoàn tác.")) {
      const res = await clearPestHistory();
      if (res?.success) {
        setHistory([]);
      } else {
        alert("Có lỗi xảy ra khi xóa lịch sử");
      }
    }
  };

  const handleCaptureCamera = async () => {
    setAnalyzing(true);
    setAnalysisResult(null);
    setCaptureError(null);
    // Giữ livestream trong lúc phân tích, chỉ tắt sau khi có kết quả
    
    const res = await captureAndAnalyze();
    if (res?.success && res?.data) {
      setIsLiveStreamMode(false); // Tắt livestream để hiện kết quả
      setAnalysisResult(res.data);
      if (res.data.image_b64) setActiveTestImage(res.data.image_b64);
      else if (res.data.image_path) setActiveTestImage(`${res.data.image_path}?t=${Date.now()}`);
      
      // Refresh lịch sử bệnh
      await refreshHistoryAfterAnalysis();
    } else {
      setCaptureError('Không thể chụp ảnh hoặc AI phân tích lỗi. Vui lòng thử lại.');
      // Tự động ẩn lỗi sau 5 giây
      setTimeout(() => setCaptureError(null), 5000);
    }
    setAnalyzing(false);
  };


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
      {/* Live Camera / Test Image View Section */}
      <section className="glass-panel p-4 sm:p-6">
        <div className="flex flex-wrap items-center justify-between gap-3 mb-4">
          <div>
            <h2 className="text-xl font-bold text-slate-900 flex items-center gap-2">
              <Camera className="w-5 h-5 text-emerald-600" />
              Camera & Nhận diện Bệnh AI
            </h2>
            <p className="text-sm text-slate-500">
              {activeTestImage 
                ? 'Đang xem ảnh mẫu từ thẻ nhớ' 
                : 'Luồng camera thời gian thực / Kết quả nhận diện gần nhất'}
            </p>
          </div>
          
          <div className="flex flex-wrap items-center gap-2 mt-2 sm:mt-0">
            {/* Chụp trực tiếp */}
            <button 
              onClick={handleCaptureCamera}
              disabled={analyzing}
              className="flex items-center gap-1.5 px-3 py-1.5 bg-rose-50 hover:bg-rose-100 text-rose-700 font-bold text-xs rounded-lg border border-rose-200 transition-colors shadow-sm disabled:opacity-50"
              title="Chụp 1 kiểu ảnh từ webcam và ném cho AI nhận diện ngay"
            >
              <Camera className="w-4 h-4 text-rose-600" />
              <span>Chụp & Nhận diện ngay</span>
            </button>

            <button 
              onClick={() => {
                setIsLiveStreamMode(!isLiveStreamMode);
                if (isLiveStreamMode) {
                  // Đang tắt live -> bật live, clear ảnh test
                  setActiveTestImage(null);
                }
              }}
              className={`flex items-center gap-1.5 px-3 py-1.5 font-bold text-xs rounded-lg border transition-colors shadow-sm ${
                isLiveStreamMode 
                ? 'bg-blue-600 text-white border-blue-700' 
                : 'bg-slate-100 text-slate-700 border-slate-300 hover:bg-slate-200'
              }`}
            >
              <Video className="w-4 h-4" />
              <span>{isLiveStreamMode ? '🔴 Tắt Livestream' : 'Bật Livestream'}</span>
            </button>

            <button 
              onClick={() => setShowTestModal(true)}
              className="flex items-center gap-1.5 px-3 py-1.5 bg-emerald-50 hover:bg-emerald-100 text-emerald-700 font-semibold text-xs rounded-lg border border-emerald-200 transition-colors shadow-sm"
              title="Chọn ảnh trong thẻ nhớ của Pi"
            >
              <FolderOpen className="w-4 h-4 text-emerald-600" />
              <span>Thẻ nhớ ({testImages.length})</span>
            </button>

            <button 
              onClick={() => fileInputRef.current?.click()}
              disabled={uploading}
              className="flex items-center gap-1.5 px-3 py-1.5 bg-indigo-50 hover:bg-indigo-100 text-indigo-700 font-semibold text-xs rounded-lg border border-indigo-200 transition-colors shadow-sm disabled:opacity-50"
              title="Tải thêm ảnh vào thẻ nhớ Pi"
            >
              <Upload className="w-4 h-4 text-indigo-600" />
              <span>{uploading ? 'Đang tải...' : 'Tải ảnh lên Pi'}</span>
            </button>
            <input 
              type="file" 
              ref={fileInputRef} 
              onChange={handleFileUpload} 
              accept="image/*" 
              className="hidden" 
            />

            <button 
              onClick={() => {
                setActiveTestImage(null);
                setRefreshKey(Date.now());
              }}
              className="p-1.5 hover:bg-slate-100 text-slate-600 rounded-lg border border-slate-200 transition-colors"
              title="Làm mới"
            >
              <RefreshCw className="w-4 h-4" />
            </button>

            <div className="flex items-center gap-2 px-3 py-1 bg-rose-50 text-rose-600 rounded-full border border-rose-200">
              <div className="w-2 h-2 rounded-full bg-rose-500 animate-pulse" />
              <span className="text-xs font-bold uppercase tracking-wider">
                {activeTestImage ? 'TEST VIEW' : 'AI LIVE'}
              </span>
            </div>
          </div>
        </div>

        {/* Analysis Result Toast / Banner */}
        {analysisResult && (
          <div className="mb-4 p-3 bg-emerald-50 border border-emerald-200 rounded-xl flex items-center justify-between animate-fade-in-up">
            <div className="flex items-center gap-2.5">
              <Sparkles className="w-5 h-5 text-emerald-600 shrink-0" />
              <div>
                <p className="text-xs font-bold text-slate-900">
                  Kết quả phân tích: <span className="text-emerald-700">{analysisResult.pest_type}</span> ({Math.round(analysisResult.confidence * 100)}%)
                </p>
                <p className="text-[11px] text-slate-600 mt-0.5">{analysisResult.notes}</p>
              </div>
            </div>
            <button 
              onClick={() => setAnalysisResult(null)}
              className="text-slate-400 hover:text-slate-600 p-1"
            >
              <X className="w-4 h-4" />
            </button>
          </div>
        )}

        {/* Error Banner */}
        {captureError && (
          <div className="mb-4 p-3 bg-rose-50 border border-rose-200 rounded-xl flex items-center justify-between animate-fade-in-up">
            <div className="flex items-center gap-2.5">
              <AlertCircle className="w-5 h-5 text-rose-600 shrink-0" />
              <p className="text-xs font-bold text-slate-900">{captureError}</p>
            </div>
            <button 
              onClick={() => setCaptureError(null)}
              className="text-slate-400 hover:text-slate-600 p-1"
            >
              <X className="w-4 h-4" />
            </button>
          </div>
        )}

        <div className="relative w-full h-[45vh] sm:h-[55vh] md:h-[65vh] 2xl:h-[70vh] bg-slate-900 rounded-xl overflow-hidden group shadow-inner">
          {/* Active Image (Livestream OR Test image OR fallback) */}
          {isLiveStreamMode ? (
            <img 
              src={`/api/camera/stream`} 
              alt="Camera Live Stream"
              className="w-full h-full object-contain bg-slate-950"
              onError={(e) => {
                e.target.src = "https://images.unsplash.com/photo-1591857177580-dc82b9ac4e1e?q=80&w=1200&auto=format&fit=crop";
              }}
            />
          ) : (
            <img 
              src={activeTestImage || `/latest_detection.jpg?t=${refreshKey}`} 
              alt="AI Detection Feed"
              onError={(e) => {
                if (!activeTestImage) {
                  e.target.src = "https://images.unsplash.com/photo-1591857177580-dc82b9ac4e1e?q=80&w=1200&auto=format&fit=crop";
                }
              }}
              className="w-full h-full object-contain bg-slate-950"
            />
          )}

          {/* Analyzing Spinner Overlay */}
          {analyzing && (
            <div className="absolute inset-0 bg-slate-900/75 backdrop-blur-sm flex flex-col items-center justify-center text-white z-20 animate-fade-in-up">
              <Loader2 className="w-10 h-10 text-emerald-400 animate-spin mb-3" />
              <p className="font-bold text-sm tracking-wide">Đang chạy mô hình AI YOLOv8...</p>
              <p className="text-xs text-slate-300 mt-1">Đang phân tích và vẽ khung nhận diện bệnh trên ảnh</p>
            </div>
          )}

          {/* Nút Chụp nổi trên Livestream */}
          {isLiveStreamMode && !analyzing && (
            <div className="absolute bottom-20 left-1/2 -translate-x-1/2 z-20">
              <button
                onClick={handleCaptureCamera}
                className="group relative flex items-center justify-center w-16 h-16 rounded-full bg-white/20 backdrop-blur-md border-4 border-white/80 hover:border-white hover:scale-110 active:scale-95 transition-all duration-200 shadow-lg hover:shadow-xl"
                title="Chụp ảnh & Phân tích AI"
              >
                {/* Vòng tròn ngoài pulse */}
                <span className="absolute inset-0 rounded-full border-2 border-white/40 animate-ping" style={{ animationDuration: '2s' }} />
                {/* Nút bên trong */}
                <span className="w-10 h-10 rounded-full bg-rose-500 group-hover:bg-rose-400 transition-colors shadow-inner flex items-center justify-center">
                  <Camera className="w-5 h-5 text-white" />
                </span>
              </button>
              <p className="text-center text-[10px] text-white/70 font-semibold mt-1.5 tracking-wide">
                BẤM ĐỂ CHỤP & PHÂN TÍCH
              </p>
            </div>
          )}

          <div className="absolute inset-0 bg-gradient-to-t from-slate-900/60 via-transparent to-transparent pointer-events-none" />
          
          <div className="absolute bottom-4 left-4 right-4 flex items-center justify-between text-white/90 z-10">
            <div className="flex items-center gap-2 text-xs font-mono bg-black/50 px-3 py-1.5 rounded-lg backdrop-blur-md border border-white/10">
              <Sparkles className="w-3.5 h-3.5 text-emerald-400" />
              <span>YOLOv8 ONNX (Tomato Leaves 640x640)</span>
            </div>
            
            <div className="flex items-center gap-2">
              {activeTestImage && (
                <button 
                  onClick={() => {
                    setActiveTestImage(null);
                    setAnalysisResult(null);
                  }}
                  className="px-2.5 py-1 text-xs font-medium bg-white/20 hover:bg-white/30 text-white rounded-lg backdrop-blur-sm transition-colors"
                >
                  Quay lại Camera
                </button>
              )}
              <button 
                onClick={() => setSelectedImage(activeTestImage || `/latest_detection.jpg?t=${refreshKey}`)}
                className="p-2 hover:bg-white/20 rounded-lg backdrop-blur-sm transition-colors text-white"
                title="Phóng to ảnh"
              >
                <Maximize2 className="w-4 h-4" />
              </button>
            </div>
          </div>
        </div>
      </section>

      {/* Pest History Gallery */}
      <section>
        <div className="flex items-center justify-between mb-4 px-2">
          <div>
            <h2 className="text-xl font-bold text-slate-900">Lịch sử phát hiện bệnh hại</h2>
            <p className="text-sm text-slate-500">Các kết quả quét từ camera và ảnh test của hệ thống AI</p>
          </div>
          <div className="flex items-center gap-4">
            <span className="text-xs font-medium text-slate-500">
              Tổng cộng: {history.length} bản ghi
            </span>
            {history.length > 0 && (
              <button 
                onClick={handleClearHistory}
                className="flex items-center gap-1.5 px-3 py-1.5 bg-rose-50 hover:bg-rose-100 text-rose-600 rounded-lg border border-rose-200 transition-colors text-xs font-semibold shadow-sm"
              >
                <Trash2 className="w-3.5 h-3.5" />
                <span>Xóa tất cả</span>
              </button>
            )}
          </div>
        </div>

        {loading ? (
          <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-4 gap-4 animate-pulse">
            {[1,2,3,4].map(i => <div key={i} className="h-48 bg-slate-200/60 rounded-xl" />)}
          </div>
        ) : history.length === 0 ? (
          <div className="glass-panel p-8 text-center text-slate-500">
            <CheckCircle2 className="w-12 h-12 text-emerald-500 mx-auto mb-2 opacity-80" />
            <p className="font-semibold text-slate-700">Chưa có bản ghi sâu bệnh nào!</p>
            <p className="text-xs text-slate-400 mt-1">Hệ thống đang hoạt động và sẵn sàng quét khi có cây bị bệnh.</p>
          </div>
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-4">
            {history.map((item) => {
              const sev = severityConfig[item.severity] || severityConfig.low;
              const hasImage = !!item.image_path;

              return (
                <div key={item.id} className="glass-panel overflow-hidden group hover:shadow-md transition-shadow">
                  <div 
                    className="relative h-40 bg-slate-900 cursor-pointer overflow-hidden flex items-center justify-center"
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
                    {item.notes && (
                      <p className="text-[11px] text-slate-600 mt-1.5 line-clamp-2 bg-slate-50 p-1.5 rounded border border-slate-200">
                        {item.notes}
                      </p>
                    )}
                    <p className="text-[10px] text-slate-400 mt-2">{formatTime(item.timestamp)}</p>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </section>

      {/* Modal: Chọn ảnh từ thẻ nhớ */}
      {showTestModal && (
        <div 
          className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/80 backdrop-blur-sm p-4 animate-fade-in-up"
          onClick={() => setShowTestModal(false)}
        >
          <div 
            className="bg-white rounded-2xl max-w-2xl w-full max-h-[85vh] flex flex-col shadow-2xl overflow-hidden"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="p-4 border-b border-slate-100 flex items-center justify-between">
              <div>
                <h3 className="text-base font-bold text-slate-900 flex items-center gap-2">
                  <FolderOpen className="w-5 h-5 text-emerald-600" />
                  Kho ảnh mẫu trên Thẻ nhớ Pi
                </h3>
                <p className="text-xs text-slate-500 mt-0.5">Bấm vào bất kỳ ảnh nào để kích hoạt AI phân tích ngay</p>
              </div>
              <button 
                onClick={() => setShowTestModal(false)}
                className="p-1 text-slate-400 hover:text-slate-600 rounded-lg"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="p-4 overflow-y-auto flex-1">
              {testImages.length === 0 ? (
                <div className="text-center py-12 text-slate-400">
                  <FolderOpen className="w-12 h-12 mx-auto mb-2 opacity-40" />
                  <p className="text-sm font-medium">Chưa có ảnh nào trong thư mục `test_images/`</p>
                  <p className="text-xs mt-1">Dùng nút "Tải ảnh lên Pi" ở ngoài để thêm ảnh vào thẻ nhớ.</p>
                </div>
              ) : (
                <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
                  {testImages.map((img, idx) => (
                    <div 
                      key={idx}
                      onClick={() => handleSelectAndAnalyze(img.filename, img.url)}
                      className="group cursor-pointer rounded-xl border border-slate-200 overflow-hidden hover:border-emerald-500 hover:shadow-md transition-all bg-slate-50"
                    >
                      <div className="aspect-square bg-slate-900 overflow-hidden relative">
                        <img 
                          src={img.url} 
                          alt={img.filename}
                          className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-300"
                        />
                        <div className="absolute inset-0 bg-emerald-900/30 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center">
                          <span className="px-2 py-1 bg-emerald-600 text-white font-bold text-[11px] rounded-lg shadow">
                            ⚡ Phân tích AI
                          </span>
                        </div>
                      </div>
                      <div className="p-2">
                        <p className="text-[11px] font-medium text-slate-700 truncate" title={img.filename}>
                          {img.filename}
                        </p>
                        <span className="text-[10px] text-emerald-600 font-semibold group-hover:underline">
                          Chạy AI ngay →
                        </span>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>

            <div className="p-3 bg-slate-50 border-t border-slate-100 flex items-center justify-between text-xs text-slate-500">
              <span>Đang có {testImages.length} ảnh mẫu</span>
              <button 
                onClick={() => {
                  setShowTestModal(false);
                  fileInputRef.current?.click();
                }}
                className="text-emerald-600 font-semibold hover:underline flex items-center gap-1"
              >
                <Upload className="w-3.5 h-3.5" />
                Thêm ảnh mới
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Modal phóng to ảnh */}
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

