import { Thermometer, Droplets, Sprout, Activity } from 'lucide-react';

export default function ZoneCard({ zone, delay = 0 }) {
  const statusConfig = {
    active: {
      label: 'Hoạt động',
      dotColor: 'bg-emerald-500',
      badgeBg: 'bg-emerald-500/10',
      badgeText: 'text-emerald-400',
      badgeBorder: 'border-emerald-500/20',
    },
    maintenance: {
      label: 'Bảo trì',
      dotColor: 'bg-amber-500',
      badgeBg: 'bg-amber-500/10',
      badgeText: 'text-amber-400',
      badgeBorder: 'border-amber-500/20',
    },
    inactive: {
      label: 'Ngừng',
      dotColor: 'bg-dark-400',
      badgeBg: 'bg-dark-400/10',
      badgeText: 'text-dark-300',
      badgeBorder: 'border-dark-400/20',
    },
  };

  const status = statusConfig[zone.status] || statusConfig.inactive;

  const metrics = [
    {
      icon: Thermometer,
      label: 'Nhiệt độ',
      value: zone.latest_temp,
      unit: '°C',
      color: 'text-rose-400',
      iconColor: 'text-rose-400/70',
    },
    {
      icon: Droplets,
      label: 'Độ ẩm KK',
      value: zone.latest_humidity,
      unit: '%',
      color: 'text-cyan-400',
      iconColor: 'text-cyan-400/70',
    },
    {
      icon: Sprout,
      label: 'Độ ẩm đất',
      value: zone.latest_soil_moisture,
      unit: '%',
      color: 'text-emerald-400',
      iconColor: 'text-emerald-400/70',
    },
  ];

  return (
    <div
      className="glass-card hover:glass-card-hover p-5 cursor-default"
      style={{ animationDelay: `${delay}ms`, animation: 'slide-up 0.5s ease-out both' }}
    >
      {/* Zone Header */}
      <div className="flex items-start justify-between mb-4">
        <div className="flex-1 min-w-0">
          <h3 className="text-sm font-bold text-white truncate">{zone.name}</h3>
          {zone.description && (
            <p className="text-xs text-dark-300 mt-0.5 truncate">{zone.description}</p>
          )}
        </div>
        <span
          className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[10px] font-semibold uppercase tracking-wider border ${status.badgeBg} ${status.badgeText} ${status.badgeBorder}`}
        >
          <span className={`w-1.5 h-1.5 rounded-full ${status.dotColor}`} />
          {status.label}
        </span>
      </div>

      {/* Metrics */}
      <div className="space-y-3">
        {metrics.map((m) => (
          <div key={m.label} className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <m.icon className={`w-3.5 h-3.5 ${m.iconColor}`} />
              <span className="text-xs text-dark-300">{m.label}</span>
            </div>
            <span className={`text-sm font-semibold ${m.color} tabular-nums`}>
              {m.value !== null && m.value !== undefined
                ? `${Number(m.value).toFixed(1)}${m.unit}`
                : '—'}
            </span>
          </div>
        ))}
      </div>

      {/* Footer stats */}
      <div className="mt-4 pt-3 border-t border-dark-500/30 flex items-center justify-between">
        <div className="flex items-center gap-1.5">
          <Activity className="w-3 h-3 text-dark-400" />
          <span className="text-[10px] text-dark-400">
            {zone.sensor_readings || 0} readings
          </span>
        </div>
        {zone.pest_count > 0 && (
          <span className="text-[10px] font-medium text-amber-400 bg-amber-400/10 px-2 py-0.5 rounded-full">
            🐛 {zone.pest_count} cảnh báo
          </span>
        )}
      </div>
    </div>
  );
}
