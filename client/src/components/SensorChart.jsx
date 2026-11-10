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
              {entry.value == null ? '—' : typeof entry.value === 'number' ? entry.value.toFixed(1) : entry.value}
              <span className="text-[10px] text-slate-400 ml-0.5">{entry.unit || ''}</span>
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}

export default function SensorChart({ history, selectedZone }) {
  // Plot every retained Firebase reading; grouping by time hid the rapid samples.
  const chartData = useMemo(() => {
    if (!history || history.length === 0) return [];

    return [...history]
      .filter((row) => row.timestamp !== null && row.timestamp !== undefined && row.timestamp !== '' && Number.isFinite(Number(row.timestamp)))
      .sort((a, b) => Number(a.timestamp) - Number(b.timestamp))
      .map((row) => ({
        timestamp: Number(row.timestamp),
        time: new Date(Number(row.timestamp)).toLocaleTimeString('vi-VN', {
          hour: '2-digit', minute: '2-digit', second: '2-digit',
        }),
        'Nhiệt độ': row.temperature,
        'Độ ẩm KK': row.humidity,
        'Ánh sáng': row.light,
        'Độ ẩm đất': row.soil_moisture,
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
    <div className="grid grid-cols-1 xl:grid-cols-2 gap-5">
      {/* Temperature & Humidity Chart */}
      <div>
        <div className="flex items-center justify-between mb-3">
          <div>
            <h3 className="text-base font-semibold text-slate-900 font-display tracking-tight">
              Nhiệt độ & độ ẩm không khí
            </h3>
            <p className="text-xs text-slate-500 mt-1">{chartData.length} lần đo gần nhất</p>
          </div>
        </div>
        <div className="h-[230px] sm:h-[250px] w-full">
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
                interval="preserveStartEnd"
                minTickGap={24}
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
              <Legend wrapperStyle={{ paddingTop: '10px' }} iconType="circle" iconSize={7} />
              
              <Area
                type="monotone"
                dataKey="Nhiệt độ"
                connectNulls={false}
                stroke="#f43f5e"
                strokeWidth={2}
                fill="url(#gradTemp)"
                activeDot={{ r: 5, fill: '#f43f5e', stroke: '#ffffff', strokeWidth: 2 }}
              />
              <Area
                type="monotone"
                dataKey="Độ ẩm KK"
                connectNulls={false}
                stroke="#06b6d4"
                strokeWidth={2}
                fill="url(#gradHumid)"
                activeDot={{ r: 5, fill: '#06b6d4', stroke: '#ffffff', strokeWidth: 2 }}
              />
            </AreaChart>
          </ResponsiveContainer>
        </div>
      </div>

      {/* Light & Soil Moisture Chart */}
      <div>
        <div className="flex items-center justify-between mb-3">
          <div>
            <h3 className="text-base font-semibold text-slate-900 font-display tracking-tight">
              Ánh sáng & độ ẩm đất
            </h3>
            <p className="text-xs text-slate-500 mt-1">{chartData.length} lần đo gần nhất</p>
          </div>
        </div>
        <div className="h-[230px] sm:h-[250px] w-full">
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
                interval="preserveStartEnd"
                minTickGap={24}
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
              <Legend wrapperStyle={{ paddingTop: '10px' }} iconType="circle" iconSize={7} />
              
              <Area
                type="monotone"
                dataKey="Ánh sáng"
                connectNulls={false}
                stroke="#fbbf24"
                strokeWidth={2}
                fill="url(#gradLight)"
                activeDot={{ r: 5, fill: '#fbbf24', stroke: '#ffffff', strokeWidth: 2 }}
              />
              <Area
                type="monotone"
                dataKey="Độ ẩm đất"
                connectNulls={false}
                stroke="#10b981"
                strokeWidth={2}
                fill="url(#gradSoil)"
                activeDot={{ r: 5, fill: '#10b981', stroke: '#ffffff', strokeWidth: 2 }}
              />
            </AreaChart>
          </ResponsiveContainer>
        </div>
      </div>
    </div>
  );
}
