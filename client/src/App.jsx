import { useState, useEffect, useCallback } from 'react';
import { Thermometer, Droplets, Sprout, Bug } from 'lucide-react';

import Header from './components/Header';
import StatCard from './components/StatCard';
import SensorChart from './components/SensorChart';
import ZoneCard from './components/ZoneCard';
import PestTable from './components/PestTable';

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
    return () => clearInterval(interval);
  }, [loadAllData]);

  return (
    <div className="min-h-screen bg-dark-900">
      {/* Background Gradient Blobs */}
      <div className="fixed inset-0 overflow-hidden pointer-events-none">
        <div className="absolute -top-[400px] -left-[300px] w-[800px] h-[800px] rounded-full bg-emerald-500/[0.03] blur-[120px]" />
        <div className="absolute -bottom-[300px] -right-[200px] w-[600px] h-[600px] rounded-full bg-cyan-500/[0.03] blur-[120px]" />
        <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[500px] h-[500px] rounded-full bg-violet-500/[0.02] blur-[100px]" />
      </div>

      {/* Header */}
      <Header
        isConnected={isConnected}
        lastUpdate={lastUpdate}
        onRefresh={loadAllData}
      />

      {/* Main Content */}
      <main className="relative z-10 max-w-[1440px] mx-auto px-4 sm:px-6 lg:px-8 py-6 sm:py-8 space-y-6 sm:space-y-8">

        {/* Loading Skeleton */}
        {loading ? (
          <LoadingSkeleton />
        ) : (
          <>
            {/* Stat Cards Row */}
            <section>
              <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 sm:gap-4">
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
                  delay={80}
                />
                <StatCard
                  icon={Sprout}
                  label="Độ ẩm đất"
                  value={sensorLatest?.soil_moisture?.toFixed(1)}
                  unit="%"
                  color="emerald"
                  delay={160}
                />
                <StatCard
                  icon={Bug}
                  label="Cảnh báo sâu bệnh"
                  value={pestStats?.total ?? 0}
                  unit="phát hiện"
                  color="amber"
                  delay={240}
                />
              </div>
            </section>

            {/* Charts Section */}
            <section>
              <SensorChart history={sensorHistory} />
            </section>

            {/* Zone Cards */}
            <section>
              <div className="flex items-center justify-between mb-4">
                <div>
                  <h2 className="text-base font-bold text-white">🗺️ Khu vực trồng trọt</h2>
                  <p className="text-xs text-dark-300 mt-0.5">Tổng quan các khu vực trong hệ thống</p>
                </div>
                <span className="text-xs text-dark-400 bg-dark-700 px-3 py-1 rounded-full border border-dark-500/30">
                  {zones.length} khu vực
                </span>
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-3 sm:gap-4">
                {zones.map((zone, i) => (
                  <ZoneCard key={zone.id} zone={zone} delay={i * 80} />
                ))}
              </div>
            </section>

            {/* Pest Table */}
            <section>
              <PestTable pests={pestLatest} />
            </section>

            {/* Footer */}
            <footer className="text-center py-6 border-t border-dark-500/20">
              <p className="text-xs text-dark-400">
                🌱 Smart Plant Dashboard — Powered by Raspberry Pi 4 + AI Engine
              </p>
              {lastUpdate && (
                <p className="text-[10px] text-dark-400/60 mt-1">
                  Cập nhật lần cuối: {lastUpdate.toLocaleTimeString('vi-VN')}
                </p>
              )}
            </footer>
          </>
        )}
      </main>
    </div>
  );
}

/** Loading skeleton placeholder */
function LoadingSkeleton() {
  return (
    <div className="space-y-6 animate-pulse">
      {/* Stat cards skeleton */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        {[...Array(4)].map((_, i) => (
          <div key={i} className="glass-card p-5 h-[130px]">
            <div className="w-11 h-11 rounded-xl bg-dark-600 mb-4" />
            <div className="h-3 w-20 bg-dark-600 rounded mb-2" />
            <div className="h-7 w-24 bg-dark-600 rounded" />
          </div>
        ))}
      </div>
      {/* Charts skeleton */}
      <div className="grid grid-cols-1 xl:grid-cols-2 gap-6">
        {[...Array(2)].map((_, i) => (
          <div key={i} className="glass-card p-6 h-[360px]">
            <div className="h-4 w-48 bg-dark-600 rounded mb-2" />
            <div className="h-3 w-32 bg-dark-600 rounded mb-6" />
            <div className="h-[250px] bg-dark-600/30 rounded-xl" />
          </div>
        ))}
      </div>
      {/* Zone cards skeleton */}
      <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-4">
        {[...Array(4)].map((_, i) => (
          <div key={i} className="glass-card p-5 h-[200px]">
            <div className="h-4 w-32 bg-dark-600 rounded mb-2" />
            <div className="h-3 w-48 bg-dark-600 rounded mb-6" />
            <div className="space-y-3">
              <div className="h-3 bg-dark-600 rounded" />
              <div className="h-3 bg-dark-600 rounded" />
              <div className="h-3 bg-dark-600 rounded" />
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
