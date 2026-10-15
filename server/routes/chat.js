const express = require('express');
const axios = require('axios');

const router = express.Router();

const CHATBOT_FUNCTION_URL = process.env.CHATBOT_FUNCTION_URL
  || 'https://askchatbot-3kmr3fah5a-uc.a.run.app';

const SYSTEM_PREFIX = [
  '[Hệ thống: Trả lời bằng tiếng Việt, ngắn gọn, đúng trọng tâm, tối đa 3-5 câu.',
  'Không liệt kê dài dòng. Nếu cần chi tiết, hỏi người dùng muốn biết thêm không.',
  'Nếu người dùng hỏi về bệnh cây có kèm độ tin cậy %, hãy đánh giá:',
  'trên 70% là bệnh nặng cần xử lý gấp, 40-70% là bệnh trung bình cần theo dõi và xử lý,',
  'dưới 40% là bệnh nhẹ và đưa ra giải pháp phòng ngừa sớm.]',
].join(' ');

// POST /api/chat: chuyển tiếp câu hỏi tới Firebase callable askChatbot (Gemini).
router.post('/', async (req, res) => {
  const message = typeof req.body?.message === 'string' ? req.body.message.trim() : '';

  if (!message) {
    return res.status(400).json({ error: 'Message is required' });
  }

  try {
    const response = await axios.post(
      CHATBOT_FUNCTION_URL,
      { data: { text: `${SYSTEM_PREFIX}\n\n${message}` } },
      {
        headers: { 'Content-Type': 'application/json' },
        timeout: 60000,
      },
    );

    // Firebase callable trả { result: { reply } }; hỗ trợ cả HTTP function trả { reply }.
    const payload = response.data?.result ?? response.data?.data ?? response.data;
    const reply = typeof payload?.reply === 'string'
      ? payload.reply.trim()
      : typeof payload === 'string'
        ? payload.trim()
        : '';

    if (!reply) {
      console.error('[chat] askChatbot returned no reply:', response.data);
      return res.status(502).json({ error: 'AI chưa trả về nội dung. Vui lòng thử lại.' });
    }

    return res.json({ reply, timestamp: new Date().toISOString() });
  } catch (error) {
    const status = error.response?.status;
    const detail = error.response?.data?.error?.message || error.message;
    console.error(`[chat] askChatbot request failed${status ? ` (${status})` : ''}: ${detail}`);
    return res.status(502).json({
      error: 'Không gọi được trợ lý Gemini. Vui lòng thử lại sau.',
    });
  }
});

module.exports = router;
