import { useState, useEffect } from 'react';
import { Leaf, Wifi, WifiOff, RefreshCw } from 'lucide-react';

export default function Header({ isConnected, lastUpdate, onRefresh }) {
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
    <header className="sticky top-0 z-50 backdrop-blur-xl bg-dark-900/80 border-b border-dark-500/50">
      <div className="max-w-[1440px] mx-auto px-4 sm:px-6 lg:px-8 py-4">
        <div className="flex items-center justify-between">
          {/* Logo & Title */}
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-emerald-500 to-emerald-600 flex items-center justify-center shadow-lg shadow-emerald-500/20">
              <Leaf className="w-5 h-5 text-white" />
            </div>
            <div>
              <h1 className="text-lg sm:text-xl font-bold text-white tracking-tight leading-none">
                Smart Plant
              </h1>
              <p className="text-xs text-dark-300 mt-0.5 hidden sm:block">
                Hệ thống quản lý khu vườn thông minh
              </p>
            </div>
          </div>

          {/* Right Side: Status + Clock + Refresh */}
          <div className="flex items-center gap-3 sm:gap-5">
            {/* Connection Status */}
            <div className="flex items-center gap-2">
              {isConnected ? (
                <>
                  <span className="relative flex h-2.5 w-2.5">
                    <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75" />
                    <span className="relative inline-flex rounded-full h-2.5 w-2.5 bg-emerald-500" />
                  </span>
                  <Wifi className="w-4 h-4 text-emerald-400 hidden sm:block" />
                  <span className="text-xs text-emerald-400 hidden md:block font-medium">
                    Đang kết nối
                  </span>
                </>
              ) : (
                <>
                  <span className="h-2.5 w-2.5 rounded-full bg-rose-500" />
                  <WifiOff className="w-4 h-4 text-rose-400 hidden sm:block" />
                  <span className="text-xs text-rose-400 hidden md:block font-medium">
                    Mất kết nối
                  </span>
                </>
              )}
            </div>

            {/* Clock */}
            <div className="hidden sm:flex flex-col items-end">
              <span className="text-sm font-semibold text-white tabular-nums">
                {formatTime(currentTime)}
              </span>
              <span className="text-[10px] text-dark-300 leading-none mt-0.5">
                {formatDate(currentTime)}
              </span>
            </div>

            {/* Refresh Button */}
            <button
              onClick={onRefresh}
              className="p-2 rounded-lg bg-dark-700 hover:bg-dark-600 border border-dark-500/50 hover:border-emerald-500/30 transition-all duration-200 group cursor-pointer"
              title="Làm mới dữ liệu"
            >
              <RefreshCw className="w-4 h-4 text-dark-300 group-hover:text-emerald-400 transition-colors" />
            </button>
          </div>
        </div>
      </div>
    </header>
  );
}
