import { useState, useEffect, useCallback } from 'react';
import { Thermometer, Droplets, Sprout, Bug, CloudRain, LayoutDashboard, Camera as CameraIcon, Bot } from 'lucide-react';

import Header from './components/Header';
import Sidebar from './components/Sidebar';
import StatCard from './components/StatCard';
import SensorChart from './components/SensorChart';
import ZoneCard from './components/ZoneCard';
import PestTable from './components/PestTable';
import CameraPestTab from './components/CameraPestTab';
import ChatbotTab from './components/ChatbotTab';

import {
  fetchHealth,
  fetchSensorLatest,
  fetchSensorHistory,
  fetchZones,
  fetchPestLatest,
  fetchPestStats,
} from './api';

const REFRESH_INTERVAL = 30_000; // 30 seconds

export default function App() {
  const [isConnected, setIsConnected] = useState(false);
  const [lastUpdate, setLastUpdate] = useState(null);
  const [loading, setLoading] = useState(true);
  const [activeTab, setActiveTab] = useState('dashboard');
  const [isSidebarCollapsed, setIsSidebarCollapsed] = useState(false);

  // Data states
  const [sensorLatest, setSensorLatest] = useState(null);
  const [sensorHistory, setSensorHistory] = useState([]);
  const [zones, setZones] = useState([]);
  const [pestLatest, setPestLatest] = useState([]);
  const [pestStats, setPestStats] = useState(null);

  const loadAllData = useCallback(async () => {
    try {
      const [health, sensor, history, zonesData, pests, stats] = await Promise.all([
        fetchHealth(),
        fetchSensorLatest(),
        fetchSensorHistory(24),
        fetchZones(),
        fetchPestLatest(10),
        fetchPestStats(),
      ]);

      setIsConnected(health?.status === 'ok');
      setSensorLatest(sensor);
      setSensorHistory(history);
      setZones(zonesData);
      setPestLatest(pests);
      setPestStats(stats);
      setLastUpdate(new Date());
    } catch (err) {
      console.error('Failed to load data:', err);
      setIsConnected(false);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadAllData();
    const interval = setInterval(loadAllData, REFRESH_INTERVAL);
  }, [loadAllData]);

  return (
    <div className="flex flex-col h-screen bg-slate-50 text-slate-800 font-sans selection:bg-emerald-500/30 overflow-hidden relative">
      {/* Full Width Header */}
      <div className="relative z-20">
        <Header
          isConnected={isConnected}
          lastUpdate={lastUpdate}
          onRefresh={loadAllData}
          activeTab={activeTab}
          onTabChange={setActiveTab}
        />
      </div>

      {/* Main Layout Area */}
      <div className="flex flex-1 overflow-hidden relative z-10">
        {/* Sidebar Navigation */}
        <Sidebar 
          activeTab={activeTab} 
          onTabChange={setActiveTab} 
          isCollapsed={isSidebarCollapsed} 
          setIsCollapsed={setIsSidebarCollapsed} 
        />

        {/* Main Content */}
        <main className="flex-1 overflow-y-auto overflow-x-hidden custom-scrollbar">
          <div className="max-w-[1600px] w-full mx-auto px-4 sm:px-6 lg:px-8 py-6 sm:py-8">

        {/* Loading Skeleton */}
        {loading ? (
          <LoadingSkeleton />
        ) : (
          <>
            {activeTab === 'dashboard' && (
              <div className="space-y-8 sm:space-y-10 animate-fade-in-up">
                {/* Stat Cards Row */}
                <section>
                  <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 sm:gap-6">
                    <StatCard
                      icon={Thermometer}
                      label="Nhiệt độ"
                      value={sensorLatest?.temperature?.toFixed(1)}
                      unit="°C"
                      color="rose"
                      delay={0}
                    />
                    <StatCard
                      icon={Droplets}
                      label="Độ ẩm không khí"
                      value={sensorLatest?.humidity?.toFixed(1)}
                      unit="%"
                      color="cyan"
                      delay={100}
                    />
                    <StatCard
                      icon={Sprout}
                      label="Độ ẩm đất"
                      value={sensorLatest?.soil_moisture?.toFixed(1)}
                      unit="%"
                      color="emerald"
                      delay={200}
                    />
                    <StatCard
                      icon={Bug}
                      label="Cảnh báo sâu bệnh"
                      value={pestStats?.total ?? 0}
                      unit="phát hiện"
                      color="amber"
                      delay={300}
                    />
                  </div>
                </section>

                {/* Charts Section */}
                <section className="glass-panel p-6 sm:p-8 animate-fade-in-up" style={{ animationDelay: '400ms' }}>
                  <SensorChart history={sensorHistory} />
                </section>

                {/* Main Layout Grid */}
                <div className="grid grid-cols-1 xl:grid-cols-3 gap-6 sm:gap-8">
                  {/* Left Column: Zones (Takes up 2/3 width on large screens) */}
                  <section className="xl:col-span-2 space-y-6 animate-fade-in-up" style={{ animationDelay: '500ms' }}>
                    <div className="flex items-center justify-between px-2">
                      <div>
                        <h2 className="text-xl font-display font-bold text-slate-900 tracking-tight">Khu vực trồng trọt</h2>
                        <p className="text-sm text-slate-500 mt-1">Tổng quan thông số các khu vực trong hệ thống</p>
                      </div>
                      <span className="text-xs font-semibold text-emerald-600 bg-emerald-500/10 px-4 py-1.5 rounded-full border border-emerald-500/20 shadow-[0_0_15px_rgba(16,185,129,0.1)]">
                        {zones.length} khu vực
                      </span>
                    </div>
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 sm:gap-6">
                      {zones.map((zone, i) => (
                        <ZoneCard key={zone.id} zone={zone} delay={600 + (i * 100)} />
                      ))}
                    </div>
                  </section>

                  {/* Right Column: Pest Table */}
                  <section className="xl:col-span-1 space-y-6 animate-fade-in-up" style={{ animationDelay: '600ms' }}>
                    <div className="flex items-center justify-between px-2">
                      <div>
                        <h2 className="text-xl font-display font-bold text-slate-900 tracking-tight">Nhật ký sâu bệnh</h2>
                        <p className="text-sm text-slate-500 mt-1">Phát hiện gần đây nhất</p>
                      </div>
                    </div>
                    <div className="h-full">
                      <PestTable pests={pestLatest} />
                    </div>
                  </section>
                </div>
              </div>
            )}

            {activeTab === 'camera' && (
              <CameraPestTab />
            )}

            {activeTab === 'chat' && (
              <ChatbotTab />
            )}

            {/* Footer */}
            <footer className="text-center py-8 pt-12">
              <div className="inline-flex items-center justify-center gap-2 mb-2">
                <CloudRain className="w-4 h-4 text-emerald-500" />
                <p className="text-sm font-medium text-slate-500 font-display">
                  Smart Plant Dashboard — Powered by Raspberry Pi 4
                </p>
              </div>
              {lastUpdate && (
                <p className="text-xs text-slate-400 font-mono">
                  SYNC: {lastUpdate.toLocaleTimeString('vi-VN')}
                </p>
              )}
            </footer>
          </>
        )}
          </div>
        </main>
      </div>
    </div>
  );
}

/** Loading skeleton placeholder */
function LoadingSkeleton() {
  return (
    <div className="space-y-8 animate-pulse">
      {/* Stat cards skeleton */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-6">
        {[...Array(4)].map((_, i) => (
          <div key={i} className="glass-panel p-6 h-[140px]">
            <div className="w-12 h-12 rounded-2xl bg-slate-200/60 mb-5" />
            <div className="h-3 w-24 bg-slate-200/60 rounded mb-3" />
            <div className="h-8 w-32 bg-slate-200/60 rounded" />
          </div>
        ))}
      </div>
      {/* Charts skeleton */}
      <div className="glass-panel p-8 h-[400px]">
        <div className="h-5 w-64 bg-slate-200/60 rounded mb-4" />
        <div className="h-4 w-48 bg-slate-200/60 rounded mb-8" />
        <div className="h-[280px] bg-slate-200/30 rounded-2xl" />
      </div>
    </div>
  );
}
