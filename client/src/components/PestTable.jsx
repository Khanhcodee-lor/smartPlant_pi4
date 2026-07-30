import { Bug, AlertTriangle, ShieldAlert, ShieldCheck, Info } from 'lucide-react';

export default function PestTable({ pests }) {
  if (!pests || pests.length === 0) {
    return (
      <div className="glass-panel p-8 h-full flex flex-col items-center justify-center text-center animate-fade-in-up">
        <div className="w-16 h-16 rounded-full bg-emerald-500/10 flex items-center justify-center mb-4 border border-emerald-500/20 shadow-[0_0_20px_rgba(16,185,129,0.15)]">
          <ShieldCheck className="w-8 h-8 text-emerald-400" />
        </div>
        <h3 className="text-lg font-bold text-slate-900 mb-2 font-display">Khu vườn an toàn</h3>
        <p className="text-sm text-slate-500 font-medium">Hệ thống AI không phát hiện bất kỳ dấu hiệu sâu bệnh nào.</p>
      </div>
    );
  }

  const severityConfig = {
    critical: {
      label: 'Nghiêm trọng',
      bg: 'bg-rose-500/10',
      text: 'text-rose-600',
      border: 'border-rose-500/20',
      icon: ShieldAlert,
      dot: 'bg-rose-500',
      shadow: 'shadow-sm'
    },
    high: {
      label: 'Cao',
      bg: 'bg-orange-500/10',
      text: 'text-orange-600',
      border: 'border-orange-500/20',
      icon: AlertTriangle,
      dot: 'bg-orange-500',
      shadow: 'shadow-sm'
    },
    medium: {
      label: 'Trung bình',
      bg: 'bg-amber-500/10',
      text: 'text-amber-600',
      border: 'border-amber-500/20',
      icon: Info,
      dot: 'bg-amber-500',
      shadow: ''
    },
    low: {
      label: 'Thấp',
      bg: 'bg-emerald-500/10',
      text: 'text-emerald-600',
      border: 'border-emerald-500/20',
      icon: ShieldCheck,
      dot: 'bg-emerald-500',
      shadow: ''
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
    <div className="glass-panel flex flex-col h-full animate-fade-in-up" style={{ animationDelay: '200ms' }}>
      {/* Mobile Cards View */}
      <div className="block sm:hidden space-y-3 p-4">
        {pests.map((pest, i) => {
          const sev = severityConfig[pest.severity] || severityConfig.low;
          return (
            <div
              key={pest.id || i}
              className="bg-white rounded-xl p-4 border border-slate-200 shadow-sm"
            >
              <div className="flex items-start justify-between mb-2">
                <div className="flex items-center gap-2">
                  <Bug className="w-4 h-4 text-amber-500" />
                  <span className="text-sm font-bold text-slate-900">{pest.pest_type}</span>
                </div>
                <span
                  className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[10px] font-bold tracking-widest uppercase border ${sev.bg} ${sev.text} ${sev.border} ${sev.shadow}`}
                >
                  <span className={`w-1.5 h-1.5 rounded-full ${sev.dot}`} />
                  {sev.label}
                </span>
              </div>
              <div className="text-xs text-slate-500 space-y-1 mt-3 font-medium">
                <p>📍 <span className="text-slate-700 font-bold">{pest.zone_name || 'Không xác định'}</span></p>
                <p>📊 Độ tin cậy: <span className="text-emerald-600 font-bold tabular-nums">{(pest.confidence * 100).toFixed(0)}%</span></p>
                <p>🕐 {formatTime(pest.timestamp)}</p>
                {pest.notes && <p className="text-slate-400 italic mt-1 bg-slate-50 p-2 rounded-lg border border-slate-200">"{pest.notes}"</p>}
              </div>
            </div>
          );
        })}
      </div>

      {/* Desktop Table View */}
      <div className="hidden sm:block overflow-x-auto flex-1 p-2">
        <table className="w-full border-collapse">
          <thead>
            <tr className="border-b border-slate-200">
              <th className="text-left text-[11px] font-bold text-slate-500 uppercase tracking-widest py-4 px-4 font-display">
                Thời gian
              </th>
              <th className="text-left text-[11px] font-bold text-slate-500 uppercase tracking-widest py-4 px-4 font-display">
                Khu vực
              </th>
              <th className="text-left text-[11px] font-bold text-slate-500 uppercase tracking-widest py-4 px-4 font-display">
                Loại sâu bệnh
              </th>
              <th className="text-left text-[11px] font-bold text-slate-500 uppercase tracking-widest py-4 px-4 font-display">
                Mức độ
              </th>
              <th className="text-left text-[11px] font-bold text-slate-500 uppercase tracking-widest py-4 px-4 font-display">
                Độ tin cậy
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
                  className="border-b border-slate-200 hover:bg-slate-50/80 transition-colors group cursor-default"
                >
                  <td className="py-4 px-4">
                    <span className="text-xs font-semibold text-slate-500 group-hover:text-slate-700 transition-colors">{formatTime(pest.timestamp)}</span>
                  </td>
                  <td className="py-4 px-4">
                    <span className="text-xs font-bold text-slate-900 tracking-wide">
                      {pest.zone_name || '—'}
                    </span>
                  </td>
                  <td className="py-4 px-4">
                    <div className="flex items-center gap-2">
                      <div className="w-6 h-6 rounded-md bg-amber-100 flex items-center justify-center border border-amber-200">
                        <Bug className="w-3.5 h-3.5 text-amber-500" />
                      </div>
                      <span className="text-xs font-bold text-slate-900 tracking-wide">{pest.pest_type}</span>
                    </div>
                  </td>
                  <td className="py-4 px-4">
                    <span
                      className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[10px] font-bold uppercase tracking-widest border ${sev.bg} ${sev.text} ${sev.border} ${sev.shadow}`}
                    >
                      <span className={`w-1.5 h-1.5 rounded-full ${sev.dot} animate-pulse`} />
                      {sev.label}
                    </span>
                  </td>
                  <td className="py-4 px-4">
                    <div className="flex items-center gap-3">
                      <div className="flex-1 h-1.5 bg-slate-200 rounded-full overflow-hidden w-full max-w-[80px] border border-slate-300 shadow-inner">
                        <div
                          className="h-full rounded-full bg-emerald-500 transition-all duration-1000 ease-out shadow-[0_0_10px_rgba(16,185,129,0.3)]"
                          style={{ width: `${confidence}%` }}
                        />
                      </div>
                      <span className="text-xs font-bold text-emerald-600 tabular-nums">
                        {confidence}%
                      </span>
                    </div>
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
