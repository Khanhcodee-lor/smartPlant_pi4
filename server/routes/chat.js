const express = require('express');
const router = express.Router();

const KNOWLEDGE_BASE = [
  {
    keywords: ['rệp xanh', 'rệp', 'rep xanh'],
    response: 'Rệp xanh thường bám ở mặt dưới lá và ngọn non, hút nhựa làm lá xoăn lại. Cách xử lý sinh học: dùng dung dịch nước rửa chén loãng hoặc tinh dầu neem (Neem oil) xịt đều lên 2 mặt lá vào chiều mát. Nếu bị nặng cần ngắt bỏ phần lá bệnh và cách ly cây.'
  },
  {
    keywords: ['sâu tơ', 'sâu', 'sau to', 'sâu ăn lá'],
    response: 'Sâu tơ là loài gây hại phổ biến trên rau họ cải (rau muống, bắp cải). Khi mới phát hiện mật độ thấp, bạn có thể bắt bằng tay. Để phòng ngừa và điều trị, nên sử dụng chế phẩm sinh học BT (Bacillus thuringiensis) hoặc phun tỏi ớt.'
  },
  {
    keywords: ['bọ trĩ', 'bo tri'],
    response: 'Bọ trĩ kích thước rất nhỏ, thường trích hút ở lá non, hoa làm lá quăn queo, rụng hoa. Xử lý: Đảm bảo độ ẩm môi trường không quá khô ráo. Dùng thuốc sinh học Radiant hoặc kết hợp tinh dầu Neem xịt liên tục 3 ngày/lần. Cắt tỉa cành bị bệnh nặng để tránh lây lan.'
  },
  {
    keywords: ['phấn trắng', 'nấm trắng', 'phan trang'],
    response: 'Bệnh phấn trắng do nấm gây ra, thường xuất hiện dạng bột trắng trên mặt lá. Bệnh lây lan nhanh khi độ ẩm cao. Cách trị: Dùng dung dịch Baking soda (1 muỗng cafe pha 1 lít nước + vài giọt nước rửa chén) phun lên lá, hoặc dùng các chế phẩm nấm đối kháng Trichoderma.'
  }
];

// POST /api/chat
router.post('/', (req, res) => {
  try {
    const { message } = req.body;
    
    if (!message) {
      return res.status(400).json({ error: 'Message is required' });
    }

    const lowerMessage = message.toLowerCase();
    let reply = 'Xin lỗi, tôi chưa hiểu rõ câu hỏi của bạn. Bạn có thể mô tả rõ hơn về loại sâu bệnh hoặc triệu chứng của cây không? (Ví dụ: cách trị rệp xanh, bệnh phấn trắng...)';

    // Tìm câu trả lời phù hợp trong Knowledge Base
    for (const item of KNOWLEDGE_BASE) {
      if (item.keywords.some(kw => lowerMessage.includes(kw))) {
        reply = item.response;
        break;
      }
    }

    // Giả lập độ trễ của AI (1-2 giây)
    setTimeout(() => {
      res.json({
        reply: reply,
        timestamp: new Date().toISOString()
      });
    }, 1000 + Math.random() * 1000);

  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
