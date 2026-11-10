import { TrendingUp, TrendingDown, Minus } from 'lucide-react';

export default function StatCard({ icon: Icon, label, value, unit, trend, color = 'emerald', delay = 0 }) {
  const colorMap = {
    emerald: {
      iconBg: 'bg-emerald-50',
      iconColor: 'text-emerald-600',
      text: 'text-emerald-600',
    },
    cyan: {
      iconBg: 'bg-cyan-50',
      iconColor: 'text-cyan-600',
      text: 'text-cyan-600',
    },
    amber: {
      iconBg: 'bg-amber-50',
      iconColor: 'text-amber-600',
      text: 'text-amber-600',
    },
    rose: {
      iconBg: 'bg-rose-50',
      iconColor: 'text-rose-600',
      text: 'text-rose-600',
    },
  };

  const c = colorMap[color] || colorMap.emerald;

  const TrendIcon = trend > 0 ? TrendingUp : trend < 0 ? TrendingDown : Minus;
  const trendColor = trend > 0 ? 'text-emerald-600' : trend < 0 ? 'text-rose-600' : 'text-slate-500';

  return (
    <div
      className="glass-panel glass-panel-hover p-4 sm:p-5 cursor-default h-full relative overflow-hidden group"
      style={{ animationDelay: `${delay}ms`, animation: 'fade-in-up 0.8s cubic-bezier(0.16, 1, 0.3, 1) both' }}
    >
      <div className="relative z-10">
        <div className="flex items-center justify-between mb-3">
          <div
            className={`w-10 h-10 rounded-xl ${c.iconBg} flex items-center justify-center`}
          >
            <Icon className={`w-5 h-5 ${c.iconColor}`} />
          </div>
          {trend !== undefined && trend !== null && (
            <div className={`flex items-center gap-1.5 ${trendColor} bg-slate-100/80 px-2.5 py-1 rounded-full border border-slate-200 shadow-inner`}>
              <TrendIcon className="w-3.5 h-3.5" />
              <span className="text-xs font-bold">
                {trend > 0 ? '+' : ''}{trend}%
              </span>
            </div>
          )}
        </div>

        <div className="space-y-1">
          <p className="text-[11px] font-semibold text-slate-500 uppercase tracking-wider">
            {label}
          </p>
          <div className="flex items-baseline gap-2">
            <span className="text-2xl sm:text-3xl font-bold text-slate-900 tabular-nums tracking-tight">
              {value !== null && value !== undefined ? value : '—'}
            </span>
            {unit && (
              <span className={`text-sm font-bold ${c.text}`}>
                {unit}
              </span>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
