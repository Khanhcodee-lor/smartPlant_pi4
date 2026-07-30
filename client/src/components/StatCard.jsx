import { TrendingUp, TrendingDown, Minus } from 'lucide-react';

export default function StatCard({ icon: Icon, label, value, unit, trend, color = 'emerald', delay = 0 }) {
  const colorMap = {
    emerald: {
      iconBg: 'from-emerald-400 to-emerald-600',
      shadow: 'shadow-emerald-500/30',
      text: 'text-emerald-600',
      glow: 'rgba(16, 185, 129, 0.4)',
      bgSoft: 'bg-emerald-500/10',
    },
    cyan: {
      iconBg: 'from-cyan-400 to-cyan-600',
      shadow: 'shadow-cyan-500/30',
      text: 'text-cyan-600',
      glow: 'rgba(6, 182, 212, 0.4)',
      bgSoft: 'bg-cyan-500/10',
    },
    amber: {
      iconBg: 'from-amber-400 to-amber-600',
      shadow: 'shadow-amber-500/30',
      text: 'text-amber-600',
      glow: 'rgba(245, 158, 11, 0.4)',
      bgSoft: 'bg-amber-500/10',
    },
    rose: {
      iconBg: 'from-rose-400 to-rose-600',
      shadow: 'shadow-rose-500/30',
      text: 'text-rose-600',
      glow: 'rgba(244, 63, 94, 0.4)',
      bgSoft: 'bg-rose-500/10',
    },
  };

  const c = colorMap[color] || colorMap.emerald;

  const TrendIcon = trend > 0 ? TrendingUp : trend < 0 ? TrendingDown : Minus;
  const trendColor = trend > 0 ? 'text-emerald-600' : trend < 0 ? 'text-rose-600' : 'text-slate-500';

  return (
    <div
      className="glass-panel glass-panel-hover p-5 sm:p-6 cursor-default h-full relative overflow-hidden group"
      style={{ animationDelay: `${delay}ms`, animation: 'fade-in-up 0.8s cubic-bezier(0.16, 1, 0.3, 1) both' }}
    >
      {/* Subtle background glow on hover */}
      <div className={`absolute -right-12 -top-12 w-32 h-32 rounded-full ${c.bgSoft} blur-2xl opacity-0 group-hover:opacity-100 transition-opacity duration-500`} />
      
      <div className="relative z-10">
        <div className="flex items-start justify-between mb-5">
          <div
            className={`w-12 h-12 rounded-2xl bg-gradient-to-br ${c.iconBg} flex items-center justify-center shadow-lg ${c.shadow} ring-1 ring-emerald-500/20 group-hover:scale-110 transition-transform duration-300`}
          >
            <Icon className="w-6 h-6 text-white" />
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

        <div className="space-y-1.5">
          <p className="text-xs font-semibold text-slate-500 uppercase tracking-widest font-display">
            {label}
          </p>
          <div className="flex items-baseline gap-2">
            <span className="text-3xl sm:text-4xl font-black text-slate-900 tabular-nums tracking-tight">
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
