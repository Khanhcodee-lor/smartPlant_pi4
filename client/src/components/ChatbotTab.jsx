import { useState, useRef, useEffect } from 'react';
import { Send, Bot, User, Loader2, Leaf, MessageCircle } from 'lucide-react';
import { fetchPestHistory, sendChatMessage } from '../api';

export default function ChatbotTab() {
  const [messages, setMessages] = useState([
    {
      id: 1,
      sender: 'bot',
      text: 'Chào bạn! Mình là trợ lý AI chuyên về cây trồng. Bạn cần hỏi gì về sâu bệnh hay cách chăm sóc cây nào?',
    },
  ]);
  const [input, setInput] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [diseaseHistory, setDiseaseHistory] = useState([]);
  const [isHistoryLoading, setIsHistoryLoading] = useState(true);
  const chatContainerRef = useRef(null);

  useEffect(() => {
    let isActive = true;

    const loadDiseaseHistory = async () => {
      const history = await fetchPestHistory(3650);
      if (!isActive) return;

      const detectedDiseases = (Array.isArray(history) ? history : [])
        .filter((item) => {
          const pestType = String(item.pest_type || '').trim();
          const isHealthy = /healthy|cây khỏe mạnh/i.test(pestType);
          const isDetected = item.status === 'detected' || (!item.status && pestType);
          return isDetected && !isHealthy;
        })
        .slice(0, 10);

      setDiseaseHistory(detectedDiseases);
      setIsHistoryLoading(false);
    };

    loadDiseaseHistory();
    const interval = setInterval(loadDiseaseHistory, 30000);

    return () => {
      isActive = false;
      clearInterval(interval);
    };
  }, []);

  const scrollToBottom = () => {
    if (chatContainerRef.current) {
      chatContainerRef.current.scrollTop = chatContainerRef.current.scrollHeight;
    }
  };

  useEffect(() => {
    scrollToBottom();
  }, [messages]);

  const sendMessage = async (messageText) => {
    const text = String(messageText || '').trim();
    if (!text || isLoading) return;

    const userMessage = { id: Date.now(), sender: 'user', text };
    setMessages((prev) => [...prev, userMessage]);
    setInput('');
    setIsLoading(true);

    try {
      const response = await sendChatMessage(userMessage.text);
      setMessages((prev) => [
        ...prev,
        {
          id: Date.now() + 1,
          sender: 'bot',
          text: response?.reply || 'Xin lỗi, tôi đang gặp sự cố kết nối. Vui lòng thử lại sau.',
        },
      ]);
    } finally {
      setIsLoading(false);
    }
  };

  const handleSend = (e) => {
    e.preventDefault();
    sendMessage(input);
  };

  const askAboutDisease = (item) => {
    const date = item.timestamp ? new Date(item.timestamp) : null;
    const detectedAt = date && !Number.isNaN(date.getTime())
      ? date.toLocaleString('vi-VN', {
        day: '2-digit', month: '2-digit', year: 'numeric',
        hour: '2-digit', minute: '2-digit',
      })
      : null;
    const location = item.zone_name ? ` tại khu vực ${item.zone_name}` : '';
    const time = detectedAt ? ` vào ${detectedAt}` : '';

    sendMessage(
      `Hệ thống vừa phát hiện ${item.pest_type}${location}${time}. Hãy hướng dẫn cách xử lý từng bước, cách ngăn bệnh lây lan và cho biết bệnh này có chữa khỏi được không.`,
    );
  };

  return (
    <div className="glass-panel p-4 sm:p-6 flex flex-col h-[calc(100dvh-220px)] min-h-[560px] animate-fade-in-up">
      <div className="flex items-center gap-3 mb-4 pb-4 border-b border-slate-200">
        <div className="w-12 h-12 rounded-2xl bg-gradient-to-br from-emerald-400 to-emerald-600 flex items-center justify-center shadow-md">
          <Bot className="w-6 h-6 text-white" />
        </div>
        <div>
          <h2 className="text-xl font-bold text-slate-900 font-display">Trợ lý AI Thực vật</h2>
          <p className="text-sm text-slate-500">Sẵn sàng giải đáp mọi thắc mắc của bạn</p>
        </div>
      </div>

      <section className="mb-4 rounded-2xl border border-emerald-100 bg-emerald-50/60 p-3 sm:p-4">
        <div className="mb-3 flex items-center gap-2">
          <Leaf className="h-4 w-4 text-emerald-600" />
          <h3 className="text-sm font-semibold text-slate-800">Lịch sử bệnh</h3>
          <span className="text-xs text-slate-500">Chọn bệnh để hỏi cách khắc phục</span>
        </div>

        {isHistoryLoading ? (
          <p className="text-xs text-slate-500">Đang tải lịch sử bệnh...</p>
        ) : diseaseHistory.length === 0 ? (
          <p className="text-xs text-slate-500">Chưa có bản ghi phát hiện bệnh.</p>
        ) : (
          <div className="flex gap-2 overflow-x-auto pb-1">
            {diseaseHistory.map((item) => (
              <button
                key={item.id}
                type="button"
                onClick={() => askAboutDisease(item)}
                disabled={isLoading}
                className="flex min-w-[220px] max-w-[280px] flex-1 items-center justify-between gap-3 rounded-xl border border-emerald-100 bg-white px-3 py-2.5 text-left transition-colors hover:border-emerald-300 hover:bg-emerald-50 disabled:cursor-wait disabled:opacity-60"
                title={`Hỏi cách xử lý ${item.pest_type}`}
              >
                <span className="min-w-0">
                  <span className="block truncate text-xs font-semibold text-slate-800">{item.pest_type}</span>
                  <span className="mt-1 block truncate text-[11px] text-slate-500">
                    {[item.zone_name, item.timestamp && !Number.isNaN(new Date(item.timestamp).getTime())
                      ? new Date(item.timestamp).toLocaleDateString('vi-VN')
                      : null].filter(Boolean).join(' · ') || 'Lần phát hiện gần đây'}
                  </span>
                </span>
                <span className="inline-flex shrink-0 items-center gap-1 rounded-lg bg-emerald-100 px-2 py-1 text-[11px] font-semibold text-emerald-700">
                  <MessageCircle className="h-3 w-3" /> Hỏi cách xử lý
                </span>
              </button>
            ))}
          </div>
        )}
      </section>

      <div ref={chatContainerRef} className="flex-1 overflow-y-auto pr-2 space-y-4 mb-4 custom-scrollbar">
        {messages.map((msg) => (
          <div
            key={msg.id}
            className={`flex items-end gap-2 ${msg.sender === 'user' ? 'flex-row-reverse' : 'flex-row'}`}
          >
            <div className={`w-8 h-8 rounded-full flex items-center justify-center shrink-0 ${msg.sender === 'user' ? 'bg-slate-200' : 'bg-emerald-100'}`}>
              {msg.sender === 'user' ? (
                <User className="w-4 h-4 text-slate-600" />
              ) : (
                <Bot className="w-4 h-4 text-emerald-600" />
              )}
            </div>
            <div
              className={`max-w-[90%] sm:max-w-[85%] px-4 py-3 rounded-2xl text-sm shadow-sm ${
                msg.sender === 'user'
                  ? 'bg-emerald-500 text-white rounded-br-none'
                  : 'bg-slate-100 text-slate-800 rounded-bl-none border border-slate-200'
              }`}
            >
              {msg.text}
            </div>
          </div>
        ))}
        {isLoading && (
          <div className="flex items-end gap-2">
            <div className="w-8 h-8 rounded-full bg-emerald-100 flex items-center justify-center shrink-0">
              <Bot className="w-4 h-4 text-emerald-600" />
            </div>
            <div className="bg-slate-100 px-4 py-3 rounded-2xl rounded-bl-none border border-slate-200">
              <Loader2 className="w-4 h-4 text-emerald-500 animate-spin" />
            </div>
          </div>
        )}

      </div>

      <form onSubmit={handleSend} className="relative mt-auto">
        <input
          type="text"
          value={input}
          onChange={(e) => setInput(e.target.value)}
          placeholder="Nhập câu hỏi của bạn..."
          className="w-full bg-white border border-slate-300 text-slate-900 rounded-xl px-4 py-3 pr-12 outline-none focus:border-emerald-500 focus:ring-2 focus:ring-emerald-500/20 transition-all shadow-sm"
        />
        <button
          type="submit"
          disabled={!input.trim() || isLoading}
          className="absolute right-2 top-1/2 -translate-y-1/2 p-2 rounded-lg bg-emerald-500 text-white disabled:opacity-50 disabled:cursor-not-allowed hover:bg-emerald-600 transition-colors"
        >
          <Send className="w-4 h-4" />
        </button>
      </form>
    </div>
  );
}
