import { useCallback, useEffect, useState } from 'react';
import { AlertCircle, Droplets, LoaderCircle, Power, RefreshCw } from 'lucide-react';
import { fetchPumpControl, setPumpCommand } from '../api';

const REFRESH_INTERVAL = 15_000;

export default function PumpControlCard() {
  const [pump, setPump] = useState(null);
  const [loading, setLoading] = useState(true);
  const [pendingCommand, setPendingCommand] = useState(null);
  const [error, setError] = useState('');

  const refresh = useCallback(async () => {
    const state = await fetchPumpControl();
    setPump(state);
    setLoading(false);
    if (state) setError('');
  }, []);

  useEffect(() => {
    refresh();
    const interval = setInterval(refresh, REFRESH_INTERVAL);
    return () => clearInterval(interval);
  }, [refresh]);

  const sendCommand = async (command) => {
    setPendingCommand(command);
    setError('');
    const result = await setPumpCommand(command);
    if (result?.success) {
      setPump(result.data);
    } else {
      setError(result?.error || 'Không gửi được lệnh điều khiển máy bơm.');
    }
    setPendingCommand(null);
  };

  const mode = String(pump?.mode || pump?.command || '').toLowerCase();
  const isAuto = mode === 'auto';
  const isOn = !isAuto && Boolean(pump?.enabled);
  const status = loading
    ? 'Đang đọc trạng thái…'
    : !pump
      ? 'Chưa nhận được trạng thái từ Firebase'
      : isAuto
        ? 'Tự động'
        : isOn
          ? 'Bơm đang bật · thủ công'
          : 'Bơm đang tắt · thủ công';

  return (
    <section className="glass-panel p-4 sm:px-5 sm:py-4">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex items-start gap-3">
          <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-cyan-50 text-cyan-700">
            <Droplets className="h-5 w-5" />
          </div>
          <div>
            <h2 className="text-lg font-display font-bold text-slate-900">Điều khiển máy bơm</h2>
            <p className="mt-1 text-sm text-slate-500">Trạng thái Firebase: <span className="font-semibold text-slate-700">{status}</span></p>
            {pump?.updated_at && (
              <p className="mt-1 text-xs text-slate-400">
                Cập nhật {new Date(pump.updated_at).toLocaleTimeString('vi-VN')}
              </p>
            )}
          </div>
        </div>

        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            onClick={() => sendCommand('auto')}
            disabled={Boolean(pendingCommand)}
            aria-pressed={isAuto}
            className={`inline-flex min-h-9 items-center gap-2 rounded-lg border px-3 text-xs font-semibold transition-colors disabled:cursor-wait disabled:opacity-60 ${isAuto ? 'border-emerald-200 bg-emerald-50 text-emerald-700' : 'border-slate-200 bg-white text-slate-600 hover:border-emerald-200 hover:text-emerald-700'}`}
          >
            {pendingCommand === 'auto' ? <LoaderCircle className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />}
            Tự động
          </button>
          <button
            type="button"
            onClick={() => sendCommand('on')}
            disabled={Boolean(pendingCommand)}
            aria-pressed={!isAuto && isOn}
            className="inline-flex min-h-9 items-center gap-2 rounded-lg bg-emerald-600 px-3 text-xs font-semibold text-white transition-colors hover:bg-emerald-700 disabled:cursor-wait disabled:opacity-60"
          >
            {pendingCommand === 'on' ? <LoaderCircle className="h-4 w-4 animate-spin" /> : <Power className="h-4 w-4" />}
            Bật bơm
          </button>
          <button
            type="button"
            onClick={() => sendCommand('off')}
            disabled={Boolean(pendingCommand)}
            aria-pressed={!isAuto && !isOn}
            className="inline-flex min-h-9 items-center gap-2 rounded-lg border border-rose-200 bg-rose-50 px-3 text-xs font-semibold text-rose-700 transition-colors hover:bg-rose-100 disabled:cursor-wait disabled:opacity-60"
          >
            {pendingCommand === 'off' ? <LoaderCircle className="h-4 w-4 animate-spin" /> : <Power className="h-4 w-4" />}
            Tắt bơm
          </button>
        </div>
      </div>

      {error && (
        <div role="alert" className="mt-4 flex items-start gap-2 rounded-xl border border-rose-200 bg-rose-50 p-3 text-sm text-rose-700">
          <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
          <span>{error}</span>
        </div>
      )}
    </section>
  );
}
