import { useState, useRef, useEffect } from 'react';
import { Send, Bot, User, Loader2 } from 'lucide-react';
import { sendChatMessage } from '../api';

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
  const chatContainerRef = useRef(null);

  const scrollToBottom = () => {
    if (chatContainerRef.current) {
      chatContainerRef.current.scrollTop = chatContainerRef.current.scrollHeight;
    }
  };

  useEffect(() => {
    scrollToBottom();
  }, [messages]);

  const handleSend = async (e) => {
    e.preventDefault();
    if (!input.trim()) return;

    const userMessage = { id: Date.now(), sender: 'user', text: input };
    setMessages((prev) => [...prev, userMessage]);
    setInput('');
    setIsLoading(true);

    const response = await sendChatMessage(userMessage.text);
    
    setIsLoading(false);
    if (response && response.reply) {
      setMessages((prev) => [
        ...prev,
        { id: Date.now() + 1, sender: 'bot', text: response.reply },
      ]);
    } else {
      setMessages((prev) => [
        ...prev,
        { id: Date.now() + 1, sender: 'bot', text: 'Xin lỗi, tôi đang gặp sự cố kết nối. Vui lòng thử lại sau.' },
      ]);
    }
  };

  return (
    <div className="glass-panel p-4 sm:p-6 flex flex-col h-[600px] animate-fade-in-up">
      <div className="flex items-center gap-3 mb-6 pb-4 border-b border-slate-200">
        <div className="w-12 h-12 rounded-2xl bg-gradient-to-br from-emerald-400 to-emerald-600 flex items-center justify-center shadow-md">
          <Bot className="w-6 h-6 text-white" />
        </div>
        <div>
          <h2 className="text-xl font-bold text-slate-900 font-display">Trợ lý AI Thực vật</h2>
          <p className="text-sm text-slate-500">Sẵn sàng giải đáp mọi thắc mắc của bạn</p>
        </div>
      </div>

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
              className={`max-w-[75%] px-4 py-3 rounded-2xl text-sm shadow-sm ${
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
