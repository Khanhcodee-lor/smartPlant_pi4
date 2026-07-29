import { useMemo } from 'react';
import {
  ResponsiveContainer,
  LineChart,
  Line,
  AreaChart,
  Area,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
} from 'recharts';

function CustomTooltip({ active, payload, label }) {
  if (!active || !payload?.length) return null;

  return (
    <div className="bg-dark-700/95 backdrop-blur-md border border-dark-500/50 rounded-xl px-4 py-3 shadow-2xl">
      <p className="text-xs text-dark-300 font-medium mb-2">{label}</p>
      {payload.map((entry, i) => (
        <div key={i} className="flex items-center gap-2 text-sm">
          <span
            className="w-2 h-2 rounded-full"
            style={{ background: entry.color }}
          />
          <span className="text-dark-300">{entry.name}:</span>
          <span className="font-semibold text-white">
            {typeof entry.value === 'number' ? entry.value.toFixed(1) : entry.value}
            {entry.unit || ''}
          </span>
        </div>
      ))}
    </div>
  );
}

export default function SensorChart({ history, selectedZone }) {
  // Process data: aggregate by timestamp, format time labels
  const chartData = useMemo(() => {
    if (!history || history.length === 0) return [];

    // If data for multiple zones, aggregate averages per timestamp
    // Group by rounded timestamp (every 15 min)
    const grouped = {};
    for (const row of history) {
      const date = new Date(row.timestamp);
      // Round to nearest 30 min for cleaner chart
      date.setMinutes(Math.round(date.getMinutes() / 30) * 30, 0, 0);
      const key = date.toISOString();

      if (!grouped[key]) {
        grouped[key] = {
          time: date.toLocaleTimeString('vi-VN', { hour: '2-digit', minute: '2-digit' }),
          timestamp: date.getTime(),
          temps: [],
          humids: [],
          lights: [],
          soils: [],
        };
      }
      if (row.temperature != null) grouped[key].temps.push(row.temperature);
      if (row.humidity != null) grouped[key].humids.push(row.humidity);
      if (row.light != null) grouped[key].lights.push(row.light);
      if (row.soil_moisture != null) grouped[key].soils.push(row.soil_moisture);
    }

    return Object.values(grouped)
      .sort((a, b) => a.timestamp - b.timestamp)
      .map((g) => ({
        time: g.time,
        'Nhiệt độ': avg(g.temps),
        'Độ ẩm KK': avg(g.humids),
        'Ánh sáng': avg(g.lights),
        'Độ ẩm đất': avg(g.soils),
      }));
  }, [history]);

  if (chartData.length === 0) {
    return (
      <div className="glass-card p-6 flex items-center justify-center h-[300px]">
        <p className="text-dark-300 text-sm">Chưa có dữ liệu cảm biến</p>
      </div>
    );
  }

  return (
    <div className="grid grid-cols-1 xl:grid-cols-2 gap-4 sm:gap-6">
      {/* Temperature & Humidity Chart */}
      <div className="glass-card p-4 sm:p-6 animate-slide-up">
        <h3 className="text-sm font-semibold text-white mb-1">
          🌡️ Nhiệt độ & Độ ẩm không khí
        </h3>
        <p className="text-xs text-dark-300 mb-4">Dữ liệu 24 giờ gần nhất</p>
        <div className="h-[280px] sm:h-[300px]">
          <ResponsiveContainer width="100%" height="100%">
            <LineChart data={chartData} margin={{ top: 5, right: 10, left: -15, bottom: 5 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="#1e293b" />
              <XAxis
                dataKey="time"
                stroke="#475569"
                fontSize={11}
                tickLine={false}
                interval="preserveStartEnd"
              />
              <YAxis stroke="#475569" fontSize={11} tickLine={false} />
              <Tooltip content={<CustomTooltip />} />
              <Legend
                wrapperStyle={{ fontSize: '12px', color: '#94a3b8' }}
                iconType="circle"
                iconSize={8}
              />
              <Line
                type="monotone"
                dataKey="Nhiệt độ"
                stroke="#f43f5e"
                strokeWidth={2.5}
                dot={false}
                activeDot={{ r: 5, fill: '#f43f5e', stroke: '#111827', strokeWidth: 2 }}
              />
              <Line
                type="monotone"
                dataKey="Độ ẩm KK"
                stroke="#06b6d4"
                strokeWidth={2.5}
                dot={false}
                activeDot={{ r: 5, fill: '#06b6d4', stroke: '#111827', strokeWidth: 2 }}
              />
            </LineChart>
          </ResponsiveContainer>
        </div>
      </div>

      {/* Light & Soil Moisture Chart */}
      <div className="glass-card p-4 sm:p-6 animate-slide-up" style={{ animationDelay: '100ms' }}>
        <h3 className="text-sm font-semibold text-white mb-1">
          ☀️ Ánh sáng & Độ ẩm đất
        </h3>
        <p className="text-xs text-dark-300 mb-4">Dữ liệu 24 giờ gần nhất</p>
        <div className="h-[280px] sm:h-[300px]">
          <ResponsiveContainer width="100%" height="100%">
            <AreaChart data={chartData} margin={{ top: 5, right: 10, left: -15, bottom: 5 }}>
              <defs>
                <linearGradient id="gradLight" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="5%" stopColor="#fbbf24" stopOpacity={0.3} />
                  <stop offset="95%" stopColor="#fbbf24" stopOpacity={0} />
                </linearGradient>
                <linearGradient id="gradSoil" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="5%" stopColor="#10b981" stopOpacity={0.3} />
                  <stop offset="95%" stopColor="#10b981" stopOpacity={0} />
                </linearGradient>
              </defs>
              <CartesianGrid strokeDasharray="3 3" stroke="#1e293b" />
              <XAxis
                dataKey="time"
                stroke="#475569"
                fontSize={11}
                tickLine={false}
                interval="preserveStartEnd"
              />
              <YAxis stroke="#475569" fontSize={11} tickLine={false} />
              <Tooltip content={<CustomTooltip />} />
              <Legend
                wrapperStyle={{ fontSize: '12px', color: '#94a3b8' }}
                iconType="circle"
                iconSize={8}
              />
              <Area
                type="monotone"
                dataKey="Ánh sáng"
                stroke="#fbbf24"
                strokeWidth={2}
                fill="url(#gradLight)"
                dot={false}
                activeDot={{ r: 5, fill: '#fbbf24', stroke: '#111827', strokeWidth: 2 }}
              />
              <Area
                type="monotone"
                dataKey="Độ ẩm đất"
                stroke="#10b981"
                strokeWidth={2}
                fill="url(#gradSoil)"
                dot={false}
                activeDot={{ r: 5, fill: '#10b981', stroke: '#111827', strokeWidth: 2 }}
              />
            </AreaChart>
          </ResponsiveContainer>
        </div>
      </div>
    </div>
  );
}

function avg(arr) {
  if (!arr || arr.length === 0) return 0;
  return Math.round((arr.reduce((a, b) => a + b, 0) / arr.length) * 10) / 10;
}
