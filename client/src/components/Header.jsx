import { useState, useEffect } from 'react';
import { Leaf, Wifi, WifiOff, RefreshCw, LayoutDashboard, Camera as CameraIcon, Bot } from 'lucide-react';

export default function Header({ isConnected, lastUpdate, onRefresh, activeTab, onTabChange }) {
  const [currentTime, setCurrentTime] = useState(new Date());

  useEffect(() => {
    const timer = setInterval(() => setCurrentTime(new Date()), 1000);
    return () => clearInterval(timer);
  }, []);

  const formatDate = (date) => {
    return date.toLocaleDateString('vi-VN', {
      weekday: 'long',
      year: 'numeric',
      month: 'long',
      day: 'numeric',
    });
  };

  const formatTime = (date) => {
    return date.toLocaleTimeString('vi-VN', {
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
    });
  };

  return (
    <header className="sticky top-0 z-30 backdrop-blur-3xl bg-white/80 border-b border-white/40 shadow-sm">
      <div className="max-w-[1600px] mx-auto px-4 sm:px-6 lg:px-8 py-3">
        <div className="flex items-center justify-between">
          
          {/* Left: Logo & Title */}
          <div className="flex items-center gap-4">
            <div className="relative group">
              <div className="absolute inset-0 bg-emerald-500 rounded-xl blur opacity-30 group-hover:opacity-50 transition-opacity duration-500" />
              <div className="relative w-11 h-11 rounded-xl bg-gradient-to-br from-emerald-400 to-emerald-600 flex items-center justify-center shadow-lg border border-emerald-500/20">
                <Leaf className="w-6 h-6 text-white" />
              </div>
            </div>
            <div>
              <h1 className="text-xl font-display font-bold text-slate-900 tracking-tight leading-tight">
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
          <div className="flex items-center gap-4 sm:gap-6 flex-1 justify-end">
            {/* Connection Status */}
            <div className="flex items-center gap-2 bg-slate-100/80 rounded-full px-3 py-1.5 border border-slate-200 shadow-inner">
              {isConnected ? (
                <>
                  <span className="relative flex h-2.5 w-2.5">
                    <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75" />
                    <span className="relative inline-flex rounded-full h-2.5 w-2.5 bg-emerald-500 shadow-[0_0_8px_rgba(16,185,129,0.5)]" />
                  </span>
                  <span className="text-xs text-emerald-600 hidden md:block font-bold tracking-wide">
                    ONLINE
                  </span>
                </>
              ) : (
                <>
                  <span className="h-2.5 w-2.5 rounded-full bg-rose-500 shadow-[0_0_8px_rgba(244,63,94,0.5)]" />
                  <span className="text-xs text-rose-600 hidden md:block font-bold tracking-wide">
                    OFFLINE
                  </span>
                </>
              )}
            </div>

            {/* Clock */}
            <div className="hidden sm:flex flex-col items-end px-4 border-r border-slate-200">
              <span className="text-sm font-bold text-slate-900 font-display tabular-nums tracking-tight">
                {formatTime(currentTime)}
              </span>
              <span className="text-[10px] text-slate-500 font-semibold uppercase tracking-wider mt-0.5">
                {formatDate(currentTime)}
              </span>
            </div>

            {/* Refresh Button */}
            <button
              onClick={onRefresh}
              className="relative p-2 rounded-xl bg-white hover:bg-slate-50 border border-slate-200 hover:border-emerald-300 shadow-sm transition-all duration-300 group cursor-pointer overflow-hidden"
              title="Làm mới dữ liệu"
            >
              <div className="absolute inset-0 bg-emerald-500/10 opacity-0 group-hover:opacity-100 transition-opacity" />
              <RefreshCw className="relative z-10 w-4 h-4 text-slate-500 group-hover:text-emerald-500 transition-colors group-hover:animate-border-spin" />
            </button>
          </div>
        </div>

        {/* Mobile Tabs Navigation (Below Header) */}
        {activeTab && onTabChange && (
          <div className="flex md:hidden items-center justify-center gap-1 mt-4 p-1 bg-slate-100/80 backdrop-blur-md rounded-xl border border-slate-200/60 shadow-inner overflow-x-auto custom-scrollbar">
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
