import { useMemo } from 'react';
import {
  ResponsiveContainer,
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
    <div className="glass-panel p-4 max-w-[200px]">
      <p className="text-xs text-slate-500 font-bold uppercase tracking-wider mb-3 font-display border-b border-slate-200 pb-2">{label}</p>
      <div className="space-y-3">
        {payload.map((entry, i) => (
          <div key={i} className="flex items-center justify-between gap-4 text-sm">
            <div className="flex items-center gap-2">
              <span
                className="w-2.5 h-2.5 rounded-sm shadow-[0_0_10px_currentColor]"
                style={{ background: entry.color, color: entry.color }}
              />
              <span className="text-slate-500 font-medium">{entry.name}</span>
            </div>
            <span className="font-bold text-slate-900 tabular-nums">
              {typeof entry.value === 'number' ? entry.value.toFixed(1) : entry.value}
              <span className="text-[10px] text-slate-400 ml-0.5">{entry.unit || ''}</span>
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}

export default function SensorChart({ history, selectedZone }) {
  // Process data: aggregate by timestamp, format time labels
  const chartData = useMemo(() => {
    if (!history || history.length === 0) return [];

    // Group by rounded timestamp (every 30 min)
    const grouped = {};
    for (const row of history) {
      const date = new Date(row.timestamp);
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
      <div className="flex items-center justify-center h-[300px]">
        <p className="text-slate-400 font-medium text-sm tracking-wide">Chưa có dữ liệu cảm biến</p>
      </div>
    );
  }

  return (
    <div className="grid grid-cols-1 xl:grid-cols-2 gap-8">
      {/* Temperature & Humidity Chart */}
      <div>
        <div className="flex items-center justify-between mb-6">
          <div>
            <h3 className="text-lg font-bold text-slate-900 font-display tracking-tight">
              🌡️ Nhiệt độ & Độ ẩm không khí
            </h3>
            <p className="text-xs text-slate-500 font-medium mt-1 uppercase tracking-wider">Dữ liệu 24 giờ gần nhất</p>
          </div>
        </div>
        <div className="h-[280px] sm:h-[320px] w-full">
          <ResponsiveContainer width="100%" height="100%">
            <AreaChart data={chartData} margin={{ top: 5, right: 0, left: -25, bottom: 0 }}>
              <defs>
                <linearGradient id="gradTemp" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor="#f43f5e" stopOpacity={0.4} />
                  <stop offset="100%" stopColor="#f43f5e" stopOpacity={0} />
                </linearGradient>
                <linearGradient id="gradHumid" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor="#06b6d4" stopOpacity={0.4} />
                  <stop offset="100%" stopColor="#06b6d4" stopOpacity={0} />
                </linearGradient>
              </defs>
              <CartesianGrid strokeDasharray="3 3" vertical={false} />
              <XAxis
                dataKey="time"
                axisLine={false}
                tickLine={false}
                tick={{ fill: '#64748b', fontSize: 11 }}
                dy={10}
              />
              <YAxis
                axisLine={false}
                tickLine={false}
                tick={{ fill: '#64748b', fontSize: 11 }}
                dx={-10}
              />
              <Tooltip content={<CustomTooltip />} cursor={{ stroke: 'rgba(0,0,0,0.05)', strokeWidth: 1, strokeDasharray: '4 4' }} />
              <Legend wrapperStyle={{ paddingTop: '20px' }} iconType="circle" iconSize={8} />
              
              <Area
                type="monotone"
                dataKey="Nhiệt độ"
                stroke="#f43f5e"
                strokeWidth={3}
                fill="url(#gradTemp)"
                activeDot={{ r: 6, fill: '#f43f5e', stroke: '#ffffff', strokeWidth: 3 }}
              />
              <Area
                type="monotone"
                dataKey="Độ ẩm KK"
                stroke="#06b6d4"
                strokeWidth={3}
                fill="url(#gradHumid)"
                activeDot={{ r: 6, fill: '#06b6d4', stroke: '#ffffff', strokeWidth: 3 }}
              />
            </AreaChart>
          </ResponsiveContainer>
        </div>
      </div>

      {/* Light & Soil Moisture Chart */}
      <div>
        <div className="flex items-center justify-between mb-6">
          <div>
            <h3 className="text-lg font-bold text-slate-900 font-display tracking-tight">
              ☀️ Ánh sáng & Độ ẩm đất
            </h3>
            <p className="text-xs text-slate-500 font-medium mt-1 uppercase tracking-wider">Dữ liệu 24 giờ gần nhất</p>
          </div>
        </div>
        <div className="h-[280px] sm:h-[320px] w-full">
          <ResponsiveContainer width="100%" height="100%">
            <AreaChart data={chartData} margin={{ top: 5, right: 0, left: -25, bottom: 0 }}>
              <defs>
                <linearGradient id="gradLight" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor="#fbbf24" stopOpacity={0.4} />
                  <stop offset="100%" stopColor="#fbbf24" stopOpacity={0} />
                </linearGradient>
                <linearGradient id="gradSoil" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor="#10b981" stopOpacity={0.4} />
                  <stop offset="100%" stopColor="#10b981" stopOpacity={0} />
                </linearGradient>
              </defs>
              <CartesianGrid strokeDasharray="3 3" vertical={false} />
              <XAxis
                dataKey="time"
                axisLine={false}
                tickLine={false}
                tick={{ fill: '#64748b', fontSize: 11 }}
                dy={10}
              />
              <YAxis
                axisLine={false}
                tickLine={false}
                tick={{ fill: '#64748b', fontSize: 11 }}
                dx={-10}
              />
              <Tooltip content={<CustomTooltip />} cursor={{ stroke: 'rgba(0,0,0,0.05)', strokeWidth: 1, strokeDasharray: '4 4' }} />
              <Legend wrapperStyle={{ paddingTop: '20px' }} iconType="circle" iconSize={8} />
              
              <Area
                type="monotone"
                dataKey="Ánh sáng"
                stroke="#fbbf24"
                strokeWidth={3}
                fill="url(#gradLight)"
                activeDot={{ r: 6, fill: '#fbbf24', stroke: '#ffffff', strokeWidth: 3 }}
              />
              <Area
                type="monotone"
                dataKey="Độ ẩm đất"
                stroke="#10b981"
                strokeWidth={3}
                fill="url(#gradSoil)"
                activeDot={{ r: 6, fill: '#10b981', stroke: '#ffffff', strokeWidth: 3 }}
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
