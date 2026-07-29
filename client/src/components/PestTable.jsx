import { Bug, AlertTriangle, ShieldAlert, ShieldCheck, Info } from 'lucide-react';

export default function PestTable({ pests }) {
  if (!pests || pests.length === 0) {
    return (
      <div className="glass-card p-6 animate-slide-up">
        <h3 className="text-sm font-semibold text-white mb-1">🐛 Phát hiện sâu bệnh</h3>
        <p className="text-xs text-dark-300 mb-6">Các cảnh báo gần đây từ AI Engine</p>
        <div className="flex flex-col items-center justify-center py-12 text-dark-400">
          <ShieldCheck className="w-10 h-10 mb-3 text-emerald-500/50" />
          <p className="text-sm font-medium">Không phát hiện sâu bệnh</p>
          <p className="text-xs text-dark-400 mt-1">Khu vườn đang an toàn</p>
        </div>
      </div>
    );
  }

  const severityConfig = {
    critical: {
      label: 'Nghiêm trọng',
      bg: 'bg-rose-500/10',
      text: 'text-rose-400',
      border: 'border-rose-500/20',
      icon: ShieldAlert,
      dot: 'bg-rose-500',
    },
    high: {
      label: 'Cao',
      bg: 'bg-orange-500/10',
      text: 'text-orange-400',
      border: 'border-orange-500/20',
      icon: AlertTriangle,
      dot: 'bg-orange-500',
    },
    medium: {
      label: 'Trung bình',
      bg: 'bg-amber-500/10',
      text: 'text-amber-400',
      border: 'border-amber-500/20',
      icon: Info,
      dot: 'bg-amber-500',
    },
    low: {
      label: 'Thấp',
      bg: 'bg-emerald-500/10',
      text: 'text-emerald-400',
      border: 'border-emerald-500/20',
      icon: ShieldCheck,
      dot: 'bg-emerald-500',
    },
  };

  const formatTime = (timestamp) => {
    const date = new Date(timestamp);
    const now = new Date();
    const diffMs = now - date;
    const diffHours = Math.floor(diffMs / (1000 * 60 * 60));

    if (diffHours < 1) return 'Vừa xong';
    if (diffHours < 24) return `${diffHours} giờ trước`;
    const diffDays = Math.floor(diffHours / 24);
    if (diffDays === 1) return 'Hôm qua';
    return `${diffDays} ngày trước`;
  };

  return (
    <div className="glass-card p-4 sm:p-6 animate-slide-up" style={{ animationDelay: '200ms' }}>
      <div className="flex items-center justify-between mb-4">
        <div>
          <h3 className="text-sm font-semibold text-white mb-0.5">🐛 Phát hiện sâu bệnh</h3>
          <p className="text-xs text-dark-300">Các cảnh báo gần đây từ AI Engine</p>
        </div>
        <span className="text-xs text-dark-400 bg-dark-600 px-3 py-1 rounded-full">
          {pests.length} kết quả
        </span>
      </div>

      {/* Mobile Cards View */}
      <div className="block sm:hidden space-y-3">
        {pests.map((pest, i) => {
          const sev = severityConfig[pest.severity] || severityConfig.low;
          const SevIcon = sev.icon;
          return (
            <div
              key={pest.id || i}
              className="bg-dark-700/50 rounded-xl p-4 border border-dark-500/30"
            >
              <div className="flex items-start justify-between mb-2">
                <div className="flex items-center gap-2">
                  <Bug className="w-4 h-4 text-amber-400" />
                  <span className="text-sm font-semibold text-white">{pest.pest_type}</span>
                </div>
                <span
                  className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-semibold border ${sev.bg} ${sev.text} ${sev.border}`}
                >
                  <span className={`w-1.5 h-1.5 rounded-full ${sev.dot}`} />
                  {sev.label}
                </span>
              </div>
              <div className="text-xs text-dark-300 space-y-1">
                <p>📍 {pest.zone_name || 'Không xác định'}</p>
                <p>📊 Độ tin cậy: {(pest.confidence * 100).toFixed(0)}%</p>
                <p>🕐 {formatTime(pest.timestamp)}</p>
                {pest.notes && <p className="text-dark-400 italic mt-1">"{pest.notes}"</p>}
              </div>
            </div>
          );
        })}
      </div>

      {/* Desktop Table View */}
      <div className="hidden sm:block overflow-x-auto">
        <table className="w-full">
          <thead>
            <tr className="border-b border-dark-500/30">
              <th className="text-left text-[10px] font-semibold text-dark-300 uppercase tracking-wider py-3 px-3">
                Thời gian
              </th>
              <th className="text-left text-[10px] font-semibold text-dark-300 uppercase tracking-wider py-3 px-3">
                Khu vực
              </th>
              <th className="text-left text-[10px] font-semibold text-dark-300 uppercase tracking-wider py-3 px-3">
                Loại sâu bệnh
              </th>
              <th className="text-left text-[10px] font-semibold text-dark-300 uppercase tracking-wider py-3 px-3">
                Mức độ
              </th>
              <th className="text-left text-[10px] font-semibold text-dark-300 uppercase tracking-wider py-3 px-3">
                Độ tin cậy
              </th>
              <th className="text-left text-[10px] font-semibold text-dark-300 uppercase tracking-wider py-3 px-3">
                Ghi chú
              </th>
            </tr>
          </thead>
          <tbody>
            {pests.map((pest, i) => {
              const sev = severityConfig[pest.severity] || severityConfig.low;
              const confidence = (pest.confidence * 100).toFixed(0);
              return (
                <tr
                  key={pest.id || i}
                  className="border-b border-dark-500/20 hover:bg-dark-600/30 transition-colors"
                >
                  <td className="py-3 px-3">
                    <span className="text-xs text-dark-300">{formatTime(pest.timestamp)}</span>
                  </td>
                  <td className="py-3 px-3">
                    <span className="text-xs font-medium text-white">
                      {pest.zone_name || '—'}
                    </span>
                  </td>
                  <td className="py-3 px-3">
                    <div className="flex items-center gap-1.5">
                      <Bug className="w-3.5 h-3.5 text-amber-400/70" />
                      <span className="text-xs font-medium text-white">{pest.pest_type}</span>
                    </div>
                  </td>
                  <td className="py-3 px-3">
                    <span
                      className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-semibold border ${sev.bg} ${sev.text} ${sev.border}`}
                    >
                      <span className={`w-1.5 h-1.5 rounded-full ${sev.dot}`} />
                      {sev.label}
                    </span>
                  </td>
                  <td className="py-3 px-3">
                    <div className="flex items-center gap-2">
                      <div className="flex-1 h-1.5 bg-dark-600 rounded-full overflow-hidden max-w-[60px]">
                        <div
                          className="h-full rounded-full bg-gradient-to-r from-emerald-500 to-emerald-400 transition-all duration-500"
                          style={{ width: `${confidence}%` }}
                        />
                      </div>
                      <span className="text-xs font-medium text-white tabular-nums">
                        {confidence}%
                      </span>
                    </div>
                  </td>
                  <td className="py-3 px-3">
                    <span className="text-xs text-dark-300 line-clamp-1 max-w-[200px] block">
                      {pest.notes || '—'}
                    </span>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}
