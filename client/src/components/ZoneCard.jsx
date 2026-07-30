import { Thermometer, Droplets, Sprout, Activity } from 'lucide-react';

export default function ZoneCard({ zone, delay = 0 }) {
  const statusConfig = {
    active: {
      label: 'Hoạt động',
      dotColor: 'bg-emerald-500',
      badgeBg: 'bg-emerald-500/10',
      badgeText: 'text-emerald-600',
      badgeBorder: 'border-emerald-500/20',
      shadow: 'shadow-[0_0_10px_rgba(16,185,129,0.15)]'
    },
    maintenance: {
      label: 'Bảo trì',
      dotColor: 'bg-amber-500',
      badgeBg: 'bg-amber-500/10',
      badgeText: 'text-amber-600',
      badgeBorder: 'border-amber-500/20',
      shadow: 'shadow-[0_0_10px_rgba(245,158,11,0.15)]'
    },
    inactive: {
      label: 'Ngừng',
      dotColor: 'bg-slate-400',
      badgeBg: 'bg-slate-400/10',
      badgeText: 'text-slate-500',
      badgeBorder: 'border-slate-400/20',
      shadow: ''
    },
  };

  const status = statusConfig[zone.status] || statusConfig.inactive;

  const metrics = [
    {
      icon: Thermometer,
      label: 'Nhiệt độ',
      value: zone.latest_temp,
      unit: '°C',
      color: 'bg-rose-500',
      textColor: 'text-rose-600',
      iconColor: 'text-rose-500',
      max: 50,
    },
    {
      icon: Droplets,
      label: 'Độ ẩm KK',
      value: zone.latest_humidity,
      unit: '%',
      color: 'bg-cyan-500',
      textColor: 'text-cyan-600',
      iconColor: 'text-cyan-500',
      max: 100,
    },
    {
      icon: Sprout,
      label: 'Độ ẩm đất',
      value: zone.latest_soil_moisture,
      unit: '%',
      color: 'bg-emerald-500',
      textColor: 'text-emerald-600',
      iconColor: 'text-emerald-500',
      max: 100,
    },
  ];

  return (
    <div
      className="glass-panel glass-panel-hover p-5 sm:p-6 cursor-default relative overflow-hidden group"
      style={{ animationDelay: `${delay}ms`, animation: 'fade-in-up 0.8s cubic-bezier(0.16, 1, 0.3, 1) both' }}
    >
      {/* Background glow effect based on status */}
      <div className={`absolute -right-8 -top-8 w-24 h-24 rounded-full ${status.dotColor} opacity-5 blur-[40px] group-hover:opacity-20 transition-opacity duration-500`} />

      {/* Zone Header */}
      <div className="flex items-start justify-between mb-6 relative z-10">
        <div className="flex-1 min-w-0 pr-3">
          <h3 className="text-base font-bold text-slate-900 truncate font-display tracking-tight">{zone.name}</h3>
          {zone.description && (
            <p className="text-xs text-slate-500 mt-1 truncate font-medium">{zone.description}</p>
          )}
        </div>
        <span
          className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full text-[10px] font-bold uppercase tracking-widest border ${status.badgeBg} ${status.badgeText} ${status.badgeBorder} ${status.shadow} transition-shadow`}
        >
          <span className={`w-1.5 h-1.5 rounded-full ${status.dotColor} animate-pulse`} />
          {status.label}
        </span>
      </div>

      {/* Metrics with Progress Bars */}
      <div className="space-y-4 relative z-10">
        {metrics.map((m) => {
          const hasValue = m.value !== null && m.value !== undefined;
          const percentage = hasValue ? Math.min(100, Math.max(0, (Number(m.value) / m.max) * 100)) : 0;
          
          return (
            <div key={m.label} className="space-y-1.5">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <m.icon className={`w-4 h-4 ${m.iconColor}`} />
                  <span className="text-xs font-semibold text-slate-500 uppercase tracking-wide">{m.label}</span>
                </div>
                <span className={`text-sm font-bold ${m.textColor} tabular-nums`}>
                  {hasValue ? `${Number(m.value).toFixed(1)}${m.unit}` : '—'}
                </span>
              </div>
              {/* Progress Bar Container */}
              <div className="h-1.5 w-full bg-slate-100 rounded-full overflow-hidden border border-slate-200 shadow-inner">
                <div 
                  className={`h-full ${m.color} rounded-full transition-all duration-1000 ease-out`}
                  style={{ width: hasValue ? `${percentage}%` : '0%', opacity: hasValue ? 1 : 0.2 }}
                />
              </div>
            </div>
          );
        })}
      </div>

      {/* Footer stats */}
      <div className="mt-6 pt-4 border-t border-slate-200/50 flex items-center justify-between relative z-10">
        <div className="flex items-center gap-1.5">
          <Activity className="w-3.5 h-3.5 text-slate-400 group-hover:text-emerald-500 transition-colors" />
          <span className="text-[10px] font-semibold tracking-wider uppercase text-slate-400 group-hover:text-slate-500 transition-colors">
            {zone.sensor_readings || 0} readings
          </span>
        </div>
        {zone.pest_count > 0 && (
          <span className="text-[10px] font-bold text-amber-600 bg-amber-50 border border-amber-200 px-2.5 py-1 rounded-full uppercase tracking-wider flex items-center gap-1 shadow-sm">
            <span className="text-[11px]">🐛</span> {zone.pest_count} cảnh báo
          </span>
        )}
      </div>
    </div>
  );
}
