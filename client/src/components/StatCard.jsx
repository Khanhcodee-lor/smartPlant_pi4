import { TrendingUp, TrendingDown, Minus } from 'lucide-react';

export default function StatCard({ icon: Icon, label, value, unit, trend, color = 'emerald', delay = 0 }) {
  const colorMap = {
    emerald: {
      iconBg: 'from-emerald-500 to-emerald-600',
      shadow: 'shadow-emerald-500/20',
      text: 'text-emerald-400',
      glow: 'rgba(16, 185, 129, 0.08)',
    },
    cyan: {
      iconBg: 'from-cyan-500 to-cyan-400',
      shadow: 'shadow-cyan-500/20',
      text: 'text-cyan-400',
      glow: 'rgba(6, 182, 212, 0.08)',
    },
    amber: {
      iconBg: 'from-amber-500 to-amber-400',
      shadow: 'shadow-amber-500/20',
      text: 'text-amber-400',
      glow: 'rgba(245, 158, 11, 0.08)',
    },
    rose: {
      iconBg: 'from-rose-500 to-rose-400',
      shadow: 'shadow-rose-500/20',
      text: 'text-rose-400',
      glow: 'rgba(244, 63, 94, 0.08)',
    },
  };

  const c = colorMap[color] || colorMap.emerald;

  const TrendIcon = trend > 0 ? TrendingUp : trend < 0 ? TrendingDown : Minus;
  const trendColor = trend > 0 ? 'text-emerald-400' : trend < 0 ? 'text-rose-400' : 'text-dark-300';

  return (
    <div
      className="glass-card hover:glass-card-hover p-5 cursor-default"
      style={{ animationDelay: `${delay}ms`, animation: 'fade-in 0.6s ease-out both' }}
    >
      <div className="flex items-start justify-between mb-4">
        <div
          className={`w-11 h-11 rounded-xl bg-gradient-to-br ${c.iconBg} flex items-center justify-center shadow-lg ${c.shadow}`}
        >
          <Icon className="w-5 h-5 text-white" />
        </div>
        {trend !== undefined && trend !== null && (
          <div className={`flex items-center gap-1 ${trendColor}`}>
            <TrendIcon className="w-3.5 h-3.5" />
            <span className="text-xs font-medium">
              {trend > 0 ? '+' : ''}{trend}%
            </span>
          </div>
        )}
      </div>

      <div className="space-y-1">
        <p className="text-xs font-medium text-dark-300 uppercase tracking-wider">
          {label}
        </p>
        <div className="flex items-baseline gap-1.5">
          <span className="text-3xl font-bold text-white tabular-nums">
            {value !== null && value !== undefined ? value : '—'}
          </span>
          {unit && (
            <span className={`text-sm font-medium ${c.text}`}>
              {unit}
            </span>
          )}
        </div>
      </div>
    </div>
  );
}
