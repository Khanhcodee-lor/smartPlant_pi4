import { useState, useEffect, useRef, useCallback } from 'react';
import { createPortal } from 'react-dom';
import { Camera, AlertCircle, Video, Maximize2, X, FolderOpen, Upload, RefreshCw, CheckCircle2, Sparkles, Loader2, ZoomIn, ZoomOut, Sliders, RotateCcw, Trash2 } from 'lucide-react';
import { fetchPestHistory, fetchTestImages, uploadTestImage, analyzeImage, clearPestHistory, deleteSelectedPestHistory, requestPiCameraCapture, fetchPiCameraCapture, fetchCameraControls, setCameraControls } from '../api';

export default function CameraPestTab() {
  const [history, setHistory] = useState([]);
  const [selectedHistoryIds, setSelectedHistoryIds] = useState(() => new Set());
  const [deletingSelected, setDeletingSelected] = useState(false);
  const [loading, setLoading] = useState(true);
  const [selectedImage, setSelectedImage] = useState(null);
  const [testImages, setTestImages] = useState([]);
  const [showTestModal, setShowTestModal] = useState(false);
  const [activeTestImage, setActiveTestImage] = useState(null);
  const [uploading, setUploading] = useState(false);
  const [analyzing, setAnalyzing] = useState(false);
  const [analysisResult, setAnalysisResult] = useState(null);
  const [captureError, setCaptureError] = useState(null);
  const [liveRefreshKey, setLiveRefreshKey] = useState(Date.now());
  const [isLiveStreamMode, setIsLiveStreamMode] = useState(false);
  const fileInputRef = useRef(null);
  const historyRefreshInProgress = useRef(false);

  // Camera Hardware (Sharpness) & Digital Zoom Controls
  const [sharpness, setSharpness] = useState(128);
  const [isUpdatingSharpness, setIsUpdatingSharpness] = useState(false);
  const [zoom, setZoom] = useState(1.0);
  const [pan, setPan] = useState({ x: 0, y: 0 });
  const [isDragging, setIsDragging] = useState(false);
  const [dragStart, setDragStart] = useState({ x: 0, y: 0 });
  const sharpnessDebounceRef = useRef(null);
  const viewerContainerRef = useRef(null);

  // Đọc thông số camera phần cứng ban đầu
  useEffect(() => {
    fetchCameraControls().then((res) => {
      if (res?.success && res?.controls?.sharpness !== undefined) {
        setSharpness(res.controls.sharpness);
      }
    });
  }, []);

  const handleSharpnessChange = (value) => {
    const val = Number(value);
    setSharpness(val);
    if (sharpnessDebounceRef.current) clearTimeout(sharpnessDebounceRef.current);
    sharpnessDebounceRef.current = setTimeout(async () => {
      setIsUpdatingSharpness(true);
      await setCameraControls({ sharpness: val });
      setIsUpdatingSharpness(false);
    }, 200);
  };

  const handleResetSharpness = async () => {
    setSharpness(128);
    setIsUpdatingSharpness(true);
    await setCameraControls({ sharpness: 128 });
    setIsUpdatingSharpness(false);
  };

  const handleZoomChange = (newZoom) => {
    const clamped = Math.max(0.8, Math.min(3.0, parseFloat(newZoom)));
    const rounded = parseFloat(clamped.toFixed(1));
    setZoom(rounded);
    if (rounded <= 1.0) {
      setPan({ x: 0, y: 0 });
    }
  };

  const handleResetZoom = () => {
    setZoom(1.0);
    setPan({ x: 0, y: 0 });
  };

  const handleWheel = (e) => {
    e.preventDefault();
    const delta = e.deltaY < 0 ? 0.2 : -0.2;
    const next = Math.max(0.8, Math.min(3.0, zoom + delta));
    handleZoomChange(next);
  };

  const handleMouseDown = (e) => {
    if (zoom <= 1.0) return;
    setIsDragging(true);
    setDragStart({ x: e.clientX - pan.x, y: e.clientY - pan.y });
  };

  const handleMouseMove = (e) => {
    if (!isDragging || zoom <= 1.0) return;
    setPan({
      x: e.clientX - dragStart.x,
      y: e.clientY - dragStart.y,
    });
  };

  const handleMouseUp = () => {
    setIsDragging(false);
  };

  const handleTouchStart = (e) => {
    if (zoom <= 1.0 || e.touches.length !== 1) return;
    const touch = e.touches[0];
    setIsDragging(true);
    setDragStart({ x: touch.clientX - pan.x, y: touch.clientY - pan.y });
  };

  const handleTouchMove = (e) => {
    if (!isDragging || zoom <= 1.0 || e.touches.length !== 1) return;
    const touch = e.touches[0];
    setPan({
      x: touch.clientX - dragStart.x,
      y: touch.clientY - dragStart.y,
    });
  };

  const handleTouchEnd = () => {
    setIsDragging(false);
  };

  const getSharpnessStatus = (val) => {
    if (val < 60) return { label: 'Rất mịn (Soft)', color: 'text-sky-600 bg-sky-50 border-sky-200' };
    if (val < 110) return { label: 'Mịn vừa', color: 'text-blue-600 bg-blue-50 border-blue-200' };
    if (val <= 145) return { label: 'Mặc định (128)', color: 'text-emerald-700 bg-emerald-50 border-emerald-200' };
    if (val <= 200) return { label: 'Tăng nét (Rõ viền)', color: 'text-amber-700 bg-amber-50 border-amber-200' };
    return { label: 'Cực nét (Soi sâu bệnh)', color: 'text-purple-700 bg-purple-50 border-purple-200' };
  };

  const fetchHistoryWithoutOverlap = useCallback(async () => {
    if (historyRefreshInProgress.current) return null;
    historyRefreshInProgress.current = true;
    try {
      return await fetchPestHistory(30);
    } finally {
      historyRefreshInProgress.current = false;
    }
  }, []);

  useEffect(() => {
    async function loadData() {
      setLoading(true);
      const [histData, testData] = await Promise.all([
        fetchHistoryWithoutOverlap(),
        fetchTestImages()
      ]);
      if (Array.isArray(histData)) setHistory(histData);
      setTestImages(testData || []);
      setLoading(false);
    }
    loadData();
  }, [fetchHistoryWithoutOverlap]);

  // Refresh history every 30 seconds while visible; detections refresh it immediately.
  useEffect(() => {
    const interval = setInterval(async () => {
      if (document.visibilityState !== 'visible') return;
      const histData = await fetchHistoryWithoutOverlap();
      if (Array.isArray(histData)) setHistory(histData);
      if (!activeTestImage) setLiveRefreshKey(Date.now());
    }, 30000);
    return () => clearInterval(interval);
  }, [activeTestImage, fetchHistoryWithoutOverlap]);

  // API ghi cả SQLite và Firestore trước khi trả kết quả nên tải lại ngay.
  const refreshHistoryAfterAnalysis = async () => {
    const updatedHist = await fetchHistoryWithoutOverlap();
    if (Array.isArray(updatedHist)) setHistory(updatedHist);
    setLiveRefreshKey(Date.now());
  };

  // Kích hoạt AI phân tích ảnh ngay lập tức
  const handleSelectAndAnalyze = async (filename, directUrl = null) => {
    setShowTestModal(false);
    setAnalyzing(true);
    setAnalysisResult(null);
    setCaptureError(null);

    const res = await analyzeImage(filename);
    if (res?.success && res?.data) {
      setAnalysisResult({ ...res.data, firebase_capture_id: res.capture?.id || null });
      // Hiển thị ảnh đã vẽ bounding box (b64 hoặc url)
      if (res.data.image_b64) {
        setActiveTestImage(res.data.image_b64);
      } else if (res.capture?.annotated_image_url) {
        setActiveTestImage(res.capture.annotated_image_url);
      } else if (res.capture?.original_image_url) {
        setActiveTestImage(res.capture.original_image_url);
      } else if (res.data.image_path) {
        setActiveTestImage(`${res.data.image_path}?t=${Date.now()}`);
      } else if (directUrl) {
        setActiveTestImage(directUrl);
      }
      // Refresh lịch sử bệnh
      await refreshHistoryAfterAnalysis();
    } else {
      if (directUrl) setActiveTestImage(directUrl);
      setCaptureError(res?.error || 'Không thể phân tích hoặc lưu ảnh test lên Firebase.');
      setTimeout(() => setCaptureError(null), 8000);
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
        setSelectedHistoryIds(new Set());
      } else {
        alert("Có lỗi xảy ra khi xóa lịch sử");
      }
    }
  };

  const toggleHistorySelection = (id) => {
    setSelectedHistoryIds(current => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const visibleSelectedItems = history.filter(item => selectedHistoryIds.has(item.id));
  const allHistorySelected = history.length > 0 && visibleSelectedItems.length === history.length;

  const handleToggleSelectAll = () => {
    setSelectedHistoryIds(current => {
      const next = new Set(current);
      if (allHistorySelected) history.forEach(item => next.delete(item.id));
      else history.forEach(item => next.add(item.id));
      return next;
    });
  };

  const handleDeleteSelected = async () => {
    if (visibleSelectedItems.length === 0 || deletingSelected) return;
    if (!window.confirm(`Xóa ${visibleSelectedItems.length} bản ghi đã chọn khỏi SQLite và Firebase?`)) return;

    setDeletingSelected(true);
    const result = await deleteSelectedPestHistory(visibleSelectedItems);
    if (result?.success) {
      const deletedIds = new Set(visibleSelectedItems.map(item => item.id));
      setHistory(current => current.filter(item => !deletedIds.has(item.id)));
      setSelectedHistoryIds(current => {
        const next = new Set(current);
        deletedIds.forEach(id => next.delete(id));
        return next;
      });
    } else {
      alert(result?.error || 'Không thể xóa các bản ghi đã chọn. Vui lòng thử lại.');
    }
    setDeletingSelected(false);
  };

  const handleCaptureCamera = async () => {
    setAnalyzing(true);
    setAnalysisResult(null);
    setCaptureError(null);
    setIsLiveStreamMode(false);
    try {
      const request = await requestPiCameraCapture();
      if (!request?.success || !request.request_id) {
        throw new Error(request?.error || 'Không gửi được lệnh chụp tới Raspberry Pi.');
      }

      const deadline = Date.now() + 120000;
      let result = null;
      while (Date.now() < deadline) {
        await new Promise(resolve => setTimeout(resolve, 2000));
        result = await fetchPiCameraCapture(request.request_id);
        if (!result?.success) {
          throw new Error(result?.error || 'Không đọc được trạng thái chụp từ Raspberry Pi.');
        }
        if (result.status === 'failed') {
          throw new Error(result.error || 'Raspberry Pi không chụp được ảnh.');
        }
        if (result.status === 'completed') break;
      }

      if (result?.status !== 'completed' || !result.capture) {
        throw new Error('Raspberry Pi chưa hoàn tất chụp ảnh sau 2 phút. Vui lòng thử lại.');
      }

      const capture = result.capture;
      const detection = capture.detections?.[0] || {};
      const disease = detection.disease_class || capture.diseaseClass || 'Không phát hiện bệnh';
      const confidence = detection.confidence ?? capture.confidence ?? 0;
      const imageUrl = capture.preview_url || capture.snapshot_url || capture.snapshotUrl;

      if (imageUrl) setActiveTestImage(imageUrl);
      setAnalysisResult({
        pest_type: disease,
        confidence: Number(confidence) || 0,
        notes: 'Ảnh được chụp trực tiếp bằng camera trên Raspberry Pi.',
        firebase_capture_id: request.request_id,
        capture_source: 'pi_camera'
      });
      setLiveRefreshKey(Date.now());
    } catch (error) {
      setIsLiveStreamMode(false);
      setCaptureError(error.message || 'Không thể chụp ảnh bằng camera Raspberry Pi.');
      setTimeout(() => setCaptureError(null), 8000);
    } finally {
      setAnalyzing(false);
    }
  };


  const severityConfig = {
    critical: { label: 'Nghiêm trọng', bg: 'bg-rose-100', text: 'text-rose-600', dot: 'bg-rose-500' },
    high: { label: 'Cao', bg: 'bg-orange-100', text: 'text-orange-600', dot: 'bg-orange-500' },
    medium: { label: 'Trung bình', bg: 'bg-amber-100', text: 'text-amber-600', dot: 'bg-amber-500' },
    low: { label: 'Nhẹ', bg: 'bg-emerald-100', text: 'text-emerald-600', dot: 'bg-emerald-500' },
  };

  const formatTime = (timestamp) => {
    if (!timestamp) return 'Thời gian không rõ';
    const d = new Date(timestamp);
    if (Number.isNaN(d.getTime())) return 'Thời gian không rõ';
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
              title="Gửi lệnh để Raspberry Pi chụp ảnh bằng camera của Pi"
            >
              <Camera className="w-4 h-4 text-rose-600" />
              <span>Chụp bằng camera Pi</span>
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
                  {analysisResult.capture_source === 'pi_camera' ? 'Ảnh từ camera Pi:' : 'Kết quả phân tích:'} <span className="text-emerald-700">{analysisResult.pest_type}</span> ({Math.round(analysisResult.confidence * 100)}%)
                </p>
                <p className="text-[11px] text-slate-600 mt-0.5">{analysisResult.notes}</p>
                {analysisResult.firebase_capture_id && (
                  <p className="text-[10px] text-emerald-700 mt-0.5">
                    Đã lưu Firebase · {analysisResult.firebase_capture_id}
                  </p>
                )}
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

        <div 
          ref={viewerContainerRef}
          onWheel={handleWheel}
          onMouseDown={handleMouseDown}
          onMouseMove={handleMouseMove}
          onMouseUp={handleMouseUp}
          onMouseLeave={handleMouseUp}
          onTouchStart={handleTouchStart}
          onTouchMove={handleTouchMove}
          onTouchEnd={handleTouchEnd}
          onDoubleClick={handleResetZoom}
          className={`relative w-full h-[45vh] sm:h-[55vh] md:h-[65vh] 2xl:h-[70vh] bg-slate-900 rounded-xl overflow-hidden group shadow-inner select-none ${
            zoom > 1 ? (isDragging ? 'cursor-grabbing' : 'cursor-grab') : 'cursor-default'
          }`}
        >
          {/* Zoomed & Panned Content Container */}
          <div 
            className="w-full h-full flex items-center justify-center transition-transform duration-75 ease-out"
            style={{
              transform: `scale(${zoom}) translate(${pan.x / zoom}px, ${pan.y / zoom}px)`,
              transformOrigin: 'center center',
            }}
          >
            {/* Active Image (Livestream OR Test image OR fallback) */}
            {isLiveStreamMode ? (
              <img 
                src={`/api/camera/stream`} 
                alt="Camera Live Stream"
                draggable={false}
                className="w-full h-full object-contain bg-slate-950 pointer-events-none"
                onError={(e) => {
                  e.target.src = "https://images.unsplash.com/photo-1591857177580-dc82b9ac4e1e?q=80&w=1200&auto=format&fit=crop";
                }}
              />
            ) : (
              <img 
                src={activeTestImage || `/latest_detection.jpg?t=${liveRefreshKey}`} 
                alt="AI Detection Feed"
                draggable={false}
                onError={(e) => {
                  if (!activeTestImage) {
                    e.target.src = "https://images.unsplash.com/photo-1591857177580-dc82b9ac4e1e?q=80&w=1200&auto=format&fit=crop";
                  }
                }}
                className="w-full h-full object-contain bg-slate-950 pointer-events-none"
              />
            )}
          </div>

          {/* Floating Zoom Indicator & Controls (Top Left & Top Right) */}
          <div className="absolute top-3 left-3 z-20 flex items-center gap-2">
            {zoom > 1.0 ? (
              <div className="flex items-center gap-1.5 px-2.5 py-1 bg-black/60 backdrop-blur-md text-white text-xs font-bold rounded-lg border border-white/20 shadow">
                <ZoomIn className="w-3.5 h-3.5 text-blue-400" />
                <span>Zoom {zoom.toFixed(1)}x</span>
                <span className="text-[10px] text-slate-300 font-normal hidden sm:inline">(Kéo chuột để di chuyển)</span>
              </div>
            ) : (
              <div className="flex items-center gap-1.5 px-2.5 py-1 bg-black/40 backdrop-blur-md text-slate-300 text-xs rounded-lg border border-white/10 opacity-70 group-hover:opacity-100 transition-opacity">
                <ZoomIn className="w-3.5 h-3.5 text-slate-400" />
                <span>1.0x (Chuẩn)</span>
              </div>
            )}
          </div>

          {/* Quick Zoom Presets Overlay on Top Right */}
          <div className="absolute top-3 right-3 z-20 flex items-center gap-1 bg-black/50 backdrop-blur-md p-1 rounded-lg border border-white/15 opacity-80 group-hover:opacity-100 transition-opacity">
            {[0.8, 1.0, 1.5, 2.0, 3.0].map((preset) => (
              <button
                key={preset}
                onClick={(e) => {
                  e.stopPropagation();
                  handleZoomChange(preset);
                }}
                className={`px-2 py-0.5 text-xs font-bold rounded transition-colors ${
                  zoom === preset
                    ? 'bg-blue-600 text-white shadow-sm'
                    : 'text-white/80 hover:bg-white/20'
                }`}
              >
                {preset}x
              </button>
            ))}
            {zoom !== 1.0 && (
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  handleResetZoom();
                }}
                title="Reset Zoom về 1.0x"
                className="p-1 text-white/70 hover:text-white rounded hover:bg-white/20 transition-colors ml-0.5"
              >
                <RotateCcw className="w-3.5 h-3.5" />
              </button>
            )}
          </div>

          {/* Analyzing Spinner Overlay */}
          {analyzing && (
            <div className="absolute inset-0 bg-slate-900/75 backdrop-blur-sm flex flex-col items-center justify-center text-white z-20 animate-fade-in-up">
              <Loader2 className="w-10 h-10 text-emerald-400 animate-spin mb-3" />
              <p className="font-bold text-sm tracking-wide">Đang chờ Raspberry Pi chụp ảnh...</p>
              <p className="text-xs text-slate-300 mt-1">Pi sẽ nhận lệnh, chụp bằng Picamera2 và gửi ảnh lên Firebase</p>
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
                onClick={() => setSelectedImage({
                  url: activeTestImage || `/latest_detection.jpg?t=${liveRefreshKey}`,
                  title: analysisResult ? `${analysisResult.pest_type} (${Math.round((analysisResult.confidence || 0) * 100)}%)` : 'Ảnh Camera / Nhận diện gần nhất',
                  time: new Date().toLocaleString('vi-VN'),
                  notes: analysisResult?.notes || 'Ảnh từ camera thời gian thực.'
                })}
                className="p-2 hover:bg-white/20 rounded-lg backdrop-blur-sm transition-colors text-white"
                title="Phóng to ảnh"
              >
                <Maximize2 className="w-4 h-4" />
              </button>
            </div>
          </div>
        </div>

        {/* Camera Hardware (Sharpness) & Software (Digital Zoom) Controls Bar */}
        <div className="mt-4 p-4 rounded-xl bg-slate-50/90 border border-slate-200/80 backdrop-blur-sm grid grid-cols-1 md:grid-cols-2 gap-4 sm:gap-6 shadow-sm">
          {/* Sharpness Control */}
          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <Sliders className="w-4 h-4 text-emerald-600" />
                <span className="text-xs font-bold text-slate-800">Độ sắc nét phần cứng (Sharpness)</span>
                {isUpdatingSharpness && (
                  <span className="text-[10px] text-emerald-600 animate-pulse font-medium">Đang lưu...</span>
                )}
              </div>
              <div className="flex items-center gap-2">
                <span className={`text-[11px] font-bold px-2 py-0.5 rounded-full border ${getSharpnessStatus(sharpness).color}`}>
                  {sharpness} — {getSharpnessStatus(sharpness).label}
                </span>
                {sharpness !== 128 && (
                  <button
                    onClick={handleResetSharpness}
                    title="Đặt lại mức mặc định 128"
                    className="text-[11px] text-slate-500 hover:text-slate-800 flex items-center gap-1 underline underline-offset-2"
                  >
                    <RotateCcw className="w-3 h-3" /> Mặc định
                  </button>
                )}
              </div>
            </div>
            <div className="flex items-center gap-3">
              <span className="text-[11px] text-slate-400 font-mono font-medium">0</span>
              <input
                type="range"
                min="0"
                max="255"
                step="1"
                value={sharpness}
                onChange={(e) => handleSharpnessChange(e.target.value)}
                className="w-full h-2 bg-slate-200 rounded-lg appearance-none cursor-pointer accent-emerald-600"
              />
              <span className="text-[11px] text-slate-400 font-mono font-medium">255</span>
            </div>
            <div className="flex justify-between text-[10px] text-slate-400 px-1 font-medium">
              <span>0 (Mịn mềm)</span>
              <span>128 (Chuẩn gốc Brio 100)</span>
              <span>255 (Sắc nét tối đa)</span>
            </div>
          </div>

          {/* Digital Zoom Control */}
          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <ZoomIn className="w-4 h-4 text-blue-600" />
                <span className="text-xs font-bold text-slate-800">Thu phóng kỹ thuật số (Digital Zoom)</span>
              </div>
              <div className="flex items-center gap-1.5">
                {[0.8, 1.0, 1.5, 2.0, 3.0].map((preset) => (
                  <button
                    key={preset}
                    onClick={() => handleZoomChange(preset)}
                    className={`px-2 py-0.5 text-xs font-bold rounded border transition-all ${
                      zoom === preset
                        ? 'bg-blue-600 text-white border-blue-700 shadow-sm'
                        : 'bg-white text-slate-600 border-slate-200 hover:bg-slate-100'
                    }`}
                  >
                    {preset}x
                  </button>
                ))}
                {zoom !== 1.0 && (
                  <button
                    onClick={handleResetZoom}
                    title="Đặt lại 1.0x"
                    className="p-1 text-slate-500 hover:text-slate-800 rounded hover:bg-slate-200 transition-colors"
                  >
                    <RotateCcw className="w-3.5 h-3.5" />
                  </button>
                )}
              </div>
            </div>
            <div className="flex items-center gap-3">
              <span className="text-[11px] text-slate-400 font-mono font-medium">0.8x</span>
              <input
                type="range"
                min="0.8"
                max="3.0"
                step="0.1"
                value={zoom}
                onChange={(e) => handleZoomChange(e.target.value)}
                className="w-full h-2 bg-slate-200 rounded-lg appearance-none cursor-pointer accent-blue-600"
              />
              <span className="text-[11px] text-slate-400 font-mono font-medium">3.0x</span>
            </div>
            <div className="flex justify-between text-[10px] text-slate-400 px-1 font-medium">
              <span>0.8x (Thu nhỏ bao quát)</span>
              <span>1.0x (Góc chuẩn 16:9 HD)</span>
              <span>3.0x (Cận cảnh đốm bệnh)</span>
            </div>
          </div>
        </div>
      </section>

      {/* Pest History Gallery */}
      <section>
        <div className="mb-4 rounded-2xl border border-slate-200/80 bg-white/80 p-4 shadow-sm backdrop-blur-sm sm:p-5">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <h2 className="text-xl font-bold text-slate-900">Lịch sử phân tích ảnh</h2>
              <p className="mt-1 max-w-2xl text-sm text-slate-500">Mọi ảnh chụp và ảnh tải lên đã được AI xử lý, kể cả ảnh không phát hiện bệnh.</p>
            </div>
            <span className="inline-flex shrink-0 items-center gap-2 rounded-full bg-slate-100 px-3 py-1.5 text-xs font-semibold text-slate-600">
              <span className="h-1.5 w-1.5 rounded-full bg-emerald-500" />
              {history.length} lần phân tích
            </span>
          </div>

          {history.length > 0 && (
            <div className="mt-4 flex flex-wrap items-center justify-between gap-3 border-t border-slate-100 pt-4">
              <div className="flex flex-wrap items-center gap-3">
                <label className="inline-flex min-h-10 cursor-pointer select-none items-center gap-2 rounded-xl border border-slate-200 bg-white px-3 text-sm font-medium text-slate-700 transition-colors hover:border-emerald-300 hover:bg-emerald-50/60">
                  <input
                    type="checkbox"
                    checked={allHistorySelected}
                    onChange={handleToggleSelectAll}
                    className="h-4 w-4 cursor-pointer accent-emerald-600"
                    aria-label="Chọn tất cả bản ghi"
                  />
                  <span>{allHistorySelected ? 'Bỏ chọn tất cả' : 'Chọn tất cả'}</span>
                </label>
                {visibleSelectedItems.length > 0 && (
                  <span className="text-xs font-medium text-slate-500" aria-live="polite">
                    Đã chọn <strong className="text-slate-700">{visibleSelectedItems.length}</strong>
                  </span>
                )}
              </div>

              <div className="flex flex-wrap items-center gap-2">
                {visibleSelectedItems.length > 0 && (
                  <button
                    onClick={handleDeleteSelected}
                    disabled={deletingSelected}
                    className="inline-flex min-h-10 items-center gap-2 rounded-xl bg-rose-600 px-3.5 text-sm font-semibold text-white shadow-sm shadow-rose-200 transition-colors hover:bg-rose-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-rose-500 focus-visible:ring-offset-2 disabled:cursor-wait disabled:opacity-60"
                  >
                    <Trash2 className="h-4 w-4" />
                    <span>{deletingSelected ? 'Đang xóa...' : 'Xóa mục đã chọn'}</span>
                  </button>
                )}
                <button
                  onClick={handleClearHistory}
                  className="inline-flex min-h-10 items-center gap-2 rounded-xl border border-rose-200 bg-white px-3.5 text-sm font-semibold text-rose-600 transition-colors hover:border-rose-300 hover:bg-rose-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-rose-400 focus-visible:ring-offset-2"
                  title="Xóa toàn bộ lịch sử phân tích"
                >
                  <Trash2 className="h-4 w-4" />
                  <span>Xóa tất cả</span>
                </button>
              </div>
            </div>
          )}
        </div>

        {loading ? (
          <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-4 gap-4 animate-pulse">
            {[1,2,3,4].map(i => <div key={i} className="h-48 bg-slate-200/60 rounded-xl" />)}
          </div>
        ) : history.length === 0 ? (
          <div className="glass-panel p-8 text-center text-slate-500">
            <CheckCircle2 className="w-12 h-12 text-emerald-500 mx-auto mb-2 opacity-80" />
            <p className="font-semibold text-slate-700">Chưa có ảnh nào được phân tích</p>
            <p className="text-xs text-slate-400 mt-1">Ảnh chụp từ camera và ảnh tải lên sẽ xuất hiện tại đây sau khi xử lý.</p>
          </div>
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-4">
            {history.map((item) => {
              const isHealthy = /healthy|cây khỏe mạnh/i.test(String(item.pest_type || ''));
              const isDetected = !isHealthy && (item.status === 'detected' || (!item.status && !!item.pest_type));
              const isAnalysisFailed = item.status === 'analysis_failed';
              const sev = severityConfig[item.severity] || severityConfig.low;
              const badge = isDetected
                ? sev
                : isAnalysisFailed
                  ? { label: 'Lỗi phân tích', bg: 'bg-rose-100', text: 'text-rose-600', dot: 'bg-rose-500' }
                  : { label: 'Không phát hiện', bg: 'bg-emerald-100', text: 'text-emerald-700', dot: 'bg-emerald-500' };
              const confidence = item.confidence !== null && item.confidence !== undefined &&
                Number.isFinite(Number(item.confidence)) ? Number(item.confidence) : null;
              const resultTitle = item.pest_type ||
                (isAnalysisFailed ? 'Không phân tích được ảnh' : 'Không phát hiện sâu bệnh');
              const hasImage = !!item.image_path;

              const isSelected = selectedHistoryIds.has(item.id);

              return (
                <div key={item.id} className={`glass-panel group overflow-hidden transition-all hover:shadow-md ${isSelected ? 'ring-2 ring-emerald-400 shadow-lg shadow-emerald-100/70' : ''}`}>
                  <div 
                    className="relative h-40 bg-slate-900 cursor-pointer overflow-hidden flex items-center justify-center"
                    onClick={() => hasImage && setSelectedImage({
                      url: item.image_path,
                      title: resultTitle,
                      confidence: confidence,
                      time: formatTime(item.timestamp),
                      notes: item.notes || item.analysis_error,
                      zone: item.zone_name || (item.source === 'camera' ? 'Camera' : item.source ? 'Ảnh tải lên' : 'Khu vực không rõ'),
                      badge: badge
                    })}
                  >
                    <label
                      className={`absolute left-2 top-2 z-10 flex h-9 w-9 cursor-pointer items-center justify-center rounded-xl border shadow-md backdrop-blur-sm transition-all ${isSelected ? 'border-emerald-300 bg-emerald-50/95' : 'border-white/80 bg-white/90 hover:bg-white'}`}
                      onClick={event => event.stopPropagation()}
                      title="Chọn bản ghi để xóa"
                    >
                      <input
                        type="checkbox"
                        checked={isSelected}
                        onChange={() => toggleHistorySelection(item.id)}
                        className="h-4 w-4 cursor-pointer accent-emerald-600"
                        aria-label={`Chọn ${resultTitle} để xóa`}
                      />
                    </label>
                    {hasImage ? (
                      <img 
                        src={item.image_path} 
                        alt={resultTitle}
                        className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-500"
                      />
                    ) : (
                      <div className="w-full h-full flex flex-col items-center justify-center text-slate-400">
                        <AlertCircle className="w-8 h-8 mb-2 opacity-50" />
                        <span className="text-xs">Không có ảnh</span>
                      </div>
                    )}
                    
                    <div className="absolute top-2 right-2">
                      <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded text-[10px] font-bold uppercase tracking-wider shadow-sm ${badge.bg} ${badge.text}`}>
                        <span className={`w-1.5 h-1.5 rounded-full ${badge.dot}`} />
                        {badge.label}
                      </span>
                    </div>
                  </div>

                  <div className="p-3">
                    <h3 className="text-sm font-bold text-slate-900">{resultTitle}</h3>
                    <div className="flex items-center justify-between mt-1 text-xs text-slate-500">
                      <span>{item.zone_name || (item.source === 'camera' ? 'Camera' : item.source ? 'Ảnh tải lên' : 'Khu vực không rõ')}</span>
                      {confidence !== null && (
                        <span className="font-semibold text-emerald-600">{(confidence * 100).toFixed(0)}%</span>
                      )}
                    </div>
                    {(item.notes || item.analysis_error) && (
                      <p className="text-[11px] text-slate-600 mt-1.5 line-clamp-2 bg-slate-50 p-1.5 rounded border border-slate-200">
                        {item.notes || item.analysis_error}
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
      {showTestModal && createPortal(
        <div 
          className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/80 backdrop-blur-sm p-4"
          onClick={() => setShowTestModal(false)}
        >
          <div 
            className="bg-white rounded-2xl max-w-2xl w-full max-h-[85vh] flex flex-col shadow-2xl overflow-hidden animate-fade-in-up"
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
        </div>,
        document.body
      )}

      {/* Modal phóng to ảnh / Chi tiết lịch sử */}
      {selectedImage && createPortal(
        <div 
          className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/80 backdrop-blur-sm p-4"
          onClick={() => setSelectedImage(null)}
        >
          <div 
            className="bg-white rounded-2xl max-w-3xl w-full max-h-[90vh] flex flex-col shadow-2xl overflow-hidden animate-fade-in-up"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="p-4 border-b border-slate-100 flex items-center justify-between bg-slate-50">
              <div>
                <h3 className="text-base font-bold text-slate-900 flex items-center gap-2">
                  {selectedImage?.title || 'Chi tiết hình ảnh'}
                </h3>
                {selectedImage?.time && (
                  <p className="text-xs text-slate-500 mt-0.5">
                    {selectedImage.time} {selectedImage.zone ? `· ${selectedImage.zone}` : ''}
                    {selectedImage.confidence !== null && selectedImage.confidence !== undefined 
                      ? ` · Độ tin cậy: ${Math.round(selectedImage.confidence * 100)}%` 
                      : ''}
                  </p>
                )}
              </div>
              <button 
                onClick={() => setSelectedImage(null)}
                className="p-1.5 text-slate-400 hover:text-slate-700 hover:bg-slate-200 rounded-lg transition-colors"
                title="Đóng (Esc)"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="p-4 overflow-y-auto flex-1 flex flex-col items-center justify-center bg-slate-950">
              <img 
                src={typeof selectedImage === 'object' ? selectedImage.url : selectedImage} 
                alt="Chi tiết"
                className="w-full h-auto max-h-[65vh] object-contain rounded-xl shadow-lg"
              />
            </div>

            {selectedImage?.notes && (
              <div className="p-3 bg-slate-50 border-t border-slate-100 text-xs text-slate-600">
                <span className="font-semibold text-slate-700">Chẩn đoán: </span>
                {selectedImage.notes}
              </div>
            )}
          </div>
        </div>,
        document.body
      )}
    </div>
  );
}
