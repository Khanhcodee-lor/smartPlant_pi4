const express = require('express');
const router = express.Router();

const KNOWLEDGE_BASE = [
  {
    keywords: ['đốm lá vi khuẩn', 'bacterial spot'],
    response: 'Đốm lá vi khuẩn không thể chữa phần lá đã bị bệnh. Hãy tỉa bỏ lá bị nặng, gom và tiêu hủy tàn dư bệnh, vệ sinh dụng cụ cắt tỉa, tránh tưới làm ướt lá và hạn chế chạm vào cây khi lá còn ướt. Theo dõi cây bên cạnh; chỉ dùng chế phẩm được phép cho cây trồng và làm đúng hướng dẫn trên nhãn.'
  },
  {
    keywords: ['sương mai sớm', 'early blight'],
    response: 'Với bệnh sương mai sớm, hãy bỏ các lá bị bệnh nặng, phủ gốc để đất không bắn lên lá, tưới vào gốc thay vì tưới lên tán và giữ tán cây thông thoáng. Thu gom tàn dư sau vụ trồng. Nếu bệnh tiếp tục lan, hỏi cán bộ nông nghiệp địa phương về thuốc được phép và dùng đúng hướng dẫn trên nhãn.'
  },
  {
    keywords: ['sương mai muộn', 'late blight'],
    response: 'Sương mai muộn lây lan rất nhanh. Cách ly cây nghi bệnh, tránh tưới lên lá và không chuyển lá/cành bệnh sang khu vực khác. Thu gom, tiêu hủy cây hoặc phần cây bệnh nặng theo quy định địa phương; không ủ chung với phân compost. Kiểm tra cây lân cận hằng ngày và hỏi cán bộ nông nghiệp địa phương về biện pháp xử lý phù hợp.'
  },
  {
    keywords: ['mốc lá', 'leaf mold'],
    response: 'Bệnh mốc lá thường nặng khi tán cây ẩm và bí. Tỉa bỏ lá bệnh, tăng thông gió, giảm thời gian lá bị ướt và tưới vào gốc. Vệ sinh tàn dư cây sau vụ. Theo dõi mặt dưới lá; nếu bệnh lan rộng, dùng chế phẩm được phép theo đúng hướng dẫn trên nhãn.'
  },
  {
    keywords: ['đốm lá septoria', 'septoria'],
    response: 'Với đốm lá Septoria, hãy loại bỏ lá bệnh ở phần dưới cây, phủ gốc để hạn chế đất bắn lên lá, tưới vào gốc và vệ sinh tàn dư cây. Tránh làm việc khi cây ướt để hạn chế lây lan. Luân canh cây trồng nếu có thể.'
  },
  {
    keywords: ['rệp xanh', 'rệp', 'rep xanh'],
    response: 'Rệp xanh thường bám ở mặt dưới lá và ngọn non, hút nhựa làm lá xoăn lại. Cách xử lý sinh học: dùng dung dịch nước rửa chén loãng hoặc tinh dầu neem (Neem oil) xịt đều lên 2 mặt lá vào chiều mát. Nếu bị nặng cần ngắt bỏ phần lá bệnh và cách ly cây.'
  },
  {
    keywords: ['sâu tơ', 'sau to', 'sâu ăn lá'],
    response: 'Sâu tơ là loài gây hại phổ biến trên rau họ cải (rau muống, bắp cải). Khi mới phát hiện mật độ thấp, bạn có thể bắt bằng tay. Để phòng ngừa và điều trị, nên sử dụng chế phẩm sinh học BT (Bacillus thuringiensis) hoặc phun tỏi ớt.'
  },
  {
    keywords: ['nhện đỏ', 'spider mites'],
    response: 'Kiểm tra kỹ mặt dưới lá để xác nhận có nhện đỏ và tơ mỏng. Có thể rửa mặt dưới lá bằng tia nước nhẹ, tỉa bỏ lá bị nặng và kiểm tra lại thường xuyên vì trứng có thể nở sau đó. Giữ cây không bị khô hạn kéo dài; nếu cần chế phẩm xử lý, chọn loại được phép cho cây trồng và làm đúng nhãn.'
  },
  {
    keywords: ['đốm mắt cua', 'target spot'],
    response: 'Với bệnh đốm mắt cua, hãy tỉa bỏ lá bệnh nặng, thu gom tàn dư, tăng độ thông thoáng và tưới vào gốc để lá nhanh khô. Theo dõi xem đốm có lan sang lá mới không; nếu vẫn lan rộng, hỏi cán bộ nông nghiệp địa phương về chế phẩm phù hợp.'
  },
  {
    keywords: ['xoăn vàng lá', 'yellow leaf curl'],
    response: 'Xoăn vàng lá do virus thì không có thuốc chữa cây đã nhiễm. Hãy cách ly và loại bỏ cây bệnh nặng để giảm nguồn lây; kiểm soát bọ phấn trắng là côn trùng truyền bệnh, vệ sinh cỏ dại quanh khu trồng và kiểm tra cây khỏe thường xuyên. Không lấy cây bệnh làm cây giống.'
  },
  {
    keywords: ['virus khảm', 'mosaic virus'],
    response: 'Bệnh khảm do virus hiện không có thuốc chữa cây đã nhiễm. Cách ly và loại bỏ cây bệnh nặng, vệ sinh dụng cụ và tay sau khi tiếp xúc, không lấy hạt/cành từ cây bệnh làm giống, đồng thời kiểm soát côn trùng truyền bệnh và cỏ dại quanh khu trồng.'
  },
  {
    keywords: ['cây khỏe mạnh', 'healthy'],
    response: 'Lịch sử ghi nhận cây khỏe mạnh, chưa thấy dấu hiệu bệnh ở lần phân tích đó. Bạn có thể tiếp tục theo dõi định kỳ, tưới vào gốc, giữ tán cây thông thoáng và kiểm tra mặt dưới lá để phát hiện sớm vấn đề.'
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

function normalizeText(value) {
  return String(value)
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/đ/g, 'd');
}

// POST /api/chat
router.post('/', (req, res) => {
  try {
    const { message } = req.body;
    
    if (!message) {
      return res.status(400).json({ error: 'Message is required' });
    }

    const lowerMessage = normalizeText(message);
    let reply = 'Xin lỗi, tôi chưa hiểu rõ câu hỏi của bạn. Bạn có thể mô tả rõ hơn về loại sâu bệnh hoặc triệu chứng của cây không? (Ví dụ: cách trị rệp xanh, bệnh phấn trắng...)';

    // Tìm câu trả lời phù hợp trong Knowledge Base
    for (const item of KNOWLEDGE_BASE) {
      if (item.keywords.some(kw => lowerMessage.includes(normalizeText(kw)))) {
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
