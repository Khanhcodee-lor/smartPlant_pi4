import { useState, useEffect } from 'react';
import { Leaf, RefreshCw, LayoutDashboard, Camera as CameraIcon, Bot } from 'lucide-react';

export default function Header({ isConnected, lastUpdate, onRefresh, activeTab, onTabChange }) {
  const [currentTime, setCurrentTime] = useState(new Date());

  useEffect(() => {
    const timer = setInterval(() => setCurrentTime(new Date()), 1000);
    return () => clearInterval(timer);
  }, []);

  const formatDate = (date) => {
    return date.toLocaleDateString('vi-VN', {
      weekday: 'short', year: 'numeric', month: '2-digit', day: '2-digit',
    });
  };

  const formatTime = (date) => {
    return date.toLocaleTimeString('vi-VN', {
      hour: '2-digit',
      minute: '2-digit',
    });
  };

  return (
    <header className="sticky top-0 z-30 bg-white border-b border-slate-200">
      <div className="max-w-[1480px] mx-auto px-4 sm:px-5 lg:px-6 py-2">
        <div className="flex items-center justify-between">
          
          {/* Left: Logo & Title */}
          <div className="flex items-center gap-3">
            <div className="relative group">
              <div className="relative w-9 h-9 rounded-xl bg-emerald-600 flex items-center justify-center shadow-sm">
                <Leaf className="w-5 h-5 text-white" />
              </div>
            </div>
            <div>
              <h1 className="text-lg font-display font-bold text-slate-900 tracking-tight leading-tight">
                Smart Plant
              </h1>
              <p className="text-[10px] text-emerald-600 font-bold tracking-wide uppercase mt-0.5 hidden sm:block">
                Hệ thống giám sát sinh thái
              </p>
            </div>
          </div>

          {/* Spacer for desktop since left side is in Sidebar */}
          <div className="hidden md:block flex-1" />

          {/* Right: Status + Clock + Refresh */}
          <div className="flex items-center gap-3 sm:gap-4 flex-1 justify-end">
            {/* Connection Status */}
            <div className="flex items-center gap-2 bg-white rounded-full px-2.5 py-1 border border-slate-200">
              {isConnected ? (
                <>
                  <span className="relative flex h-2 w-2">
                    <span className="relative inline-flex h-2 w-2 rounded-full bg-emerald-500" />
                  </span>
                  <span className="text-xs text-emerald-600 hidden md:block font-bold tracking-wide">
                    ONLINE
                  </span>
                </>
              ) : (
                <>
                  <span className="h-2 w-2 rounded-full bg-rose-500" />
                  <span className="text-xs text-rose-600 hidden md:block font-bold tracking-wide">
                    OFFLINE
                  </span>
                </>
              )}
            </div>

            {/* Clock */}
            <div className="hidden sm:flex flex-col items-end px-3 border-r border-slate-200">
              <span className="text-xs font-semibold text-slate-900 tabular-nums tracking-tight">
                {formatTime(currentTime)}
              </span>
              <span className="text-[10px] text-slate-500 font-medium mt-0.5">
                {formatDate(currentTime)}
              </span>
            </div>

            {/* Refresh Button */}
            <button
              onClick={onRefresh}
              className="relative p-2 rounded-lg bg-white hover:bg-slate-50 border border-slate-200 hover:border-emerald-300 transition-colors cursor-pointer"
              title="Làm mới dữ liệu"
            >
              <RefreshCw className="w-4 h-4 text-slate-500 hover:text-emerald-600" />
            </button>
          </div>
        </div>

        {/* Mobile Tabs Navigation (Below Header) */}
        {activeTab && onTabChange && (
          <div className="flex md:hidden items-center justify-center gap-1 mt-2 p-1 bg-slate-100 rounded-xl border border-slate-200 overflow-x-auto custom-scrollbar">
            <button
              onClick={() => onTabChange('dashboard')}
              className={`flex-shrink-0 flex items-center gap-2 px-3 py-2 rounded-lg text-xs font-bold transition-all ${
                activeTab === 'dashboard'
                  ? 'bg-white text-emerald-600 shadow-sm ring-1 ring-emerald-500/10'
                  : 'text-slate-500 hover:text-slate-700'
              }`}
            >
              <LayoutDashboard className="w-4 h-4" />
              <span>Tổng quan</span>
            </button>
            
            <button
              onClick={() => onTabChange('camera')}
              className={`flex-shrink-0 flex items-center gap-2 px-3 py-2 rounded-lg text-xs font-bold transition-all ${
                activeTab === 'camera'
                  ? 'bg-white text-emerald-600 shadow-sm ring-1 ring-emerald-500/10'
                  : 'text-slate-500 hover:text-slate-700'
              }`}
            >
              <CameraIcon className="w-4 h-4" />
              <span>Camera</span>
            </button>

            <button
              onClick={() => onTabChange('chat')}
              className={`flex-shrink-0 flex items-center gap-2 px-3 py-2 rounded-lg text-xs font-bold transition-all ${
                activeTab === 'chat'
                  ? 'bg-white text-emerald-600 shadow-sm ring-1 ring-emerald-500/10'
                  : 'text-slate-500 hover:text-slate-700'
              }`}
            >
              <Bot className="w-4 h-4" />
              <span>Trợ lý AI</span>
            </button>
          </div>
        )}
      </div>
    </header>
  );
}
