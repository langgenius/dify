const translation = {
  welcome: {
    firstStepTip: 'Để bắt đầu,',
    enterKeyTip: 'nhập khóa API OpenAI của bạn bên dưới',
    getKeyTip: 'Lấy khóa API của bạn từ bảng điều khiển OpenAI',
    placeholder: 'Khóa API OpenAI của bạn (ví dụ: sk-xxxx)',
  },
  apiKeyInfo: {
    cloud: {
      trial: {
        title: 'Bạn đang sử dụng hạn mức thử nghiệm của {{providerName}}.',
        description: 'Hạn mức thử nghiệm được cung cấp cho việc thử nghiệm của bạn. Trước khi hạn mức cuộc gọi thử nghiệm được sử dụng hết, vui lòng thiết lập nhà cung cấp mô hình của riêng bạn hoặc mua thêm hạn mức.',
      },
      exhausted: {
        title: 'Hạn mức thử nghiệm của bạn đã được sử dụng hết, vui lòng thiết lập APIKey của bạn.',
        description: 'Hạn mức thử nghiệm của bạn đã được sử dụng hết. Vui lòng thiết lập nhà cung cấp mô hình của riêng bạn hoặc mua thêm hạn mức.',
      },
    },
    selfHost: {
      title: {
        row1: 'Để bắt đầu,',
        row2: 'thiết lập nhà cung cấp mô hình của bạn trước.',
      },
    },
    callTimes: 'Số lần gọi',
    usedToken: 'Token đã sử dụng',
    setAPIBtn: 'Đi đến thiết lập nhà cung cấp mô hình',
    tryCloud: 'Hoặc thử phiên bản đám mây của Dify với báo giá miễn phí',
  },
  overview: {
    title: 'Tổng quan',
    appInfo: {
      explanation: 'WebApp Trí tuệ nhân tạo Sẵn sàng sử dụng',
      accessibleAddress: 'URL Công cộng',
      preview: 'Xem trước',
      regenerate: 'Tạo lại',
      preUseReminder: 'Vui lòng kích hoạt WebApp trước khi tiếp tục.',
      settings: {
        entry: 'Cài đặt',
        title: 'Cài đặt WebApp',
        webName: 'Tên WebApp',
        webDesc: 'Mô tả WebApp',
        webDescTip: 'Văn bản này sẽ được hiển thị trên phía máy khách, cung cấp hướng dẫn cơ bản về cách sử dụng ứng dụng',
        webDescPlaceholder: 'Nhập mô tả của WebApp',
        language: 'Ngôn ngữ',
        more: {
          entry: 'Hiển thị thêm cài đặt',
          copyright: 'Bản quyền',
          copyRightPlaceholder: 'Nhập tên tác giả hoặc tổ chức',
          privacyPolicy: 'Chính sách Bảo mật',
          privacyPolicyPlaceholder: 'Nhập liên kết chính sách bảo mật',
          privacyPolicyTip: 'Giúp người truy cập hiểu về dữ liệu mà ứng dụng thu thập, xem <privacyPolicyLink>Chính sách Bảo mật</privacyPolicyLink> của Dify.',
        },
      },
      embedded: {
        entry: 'Nhúng',
        title: 'Nhúng vào trang web',
        explanation: 'Chọn cách nhúng ứng dụng trò chuyện vào trang web của bạn',
        iframe: 'Để thêm ứng dụng trò chuyện ở bất kỳ đâu trên trang web của bạn, thêm iframe này vào mã html của bạn.',
        scripts: 'Để thêm ứng dụng trò chuyện vào phía dưới bên phải của trang web của bạn, thêm mã này vào mã html của bạn.',
        chromePlugin: 'Cài đặt Phần mở rộng Chrome Dify Chatbot',
        copied: 'Đã sao chép',
        copy: 'Sao chép',
      },
      qrcode: {
        title: 'Mã QR để chia sẻ',
        scan: 'Quét để chia sẻ ứng dụng',
        download: 'Tải về Mã QR',
      },
      customize: {
        way: 'cách',
        entry: 'Tùy chỉnh',
        title: 'Tùy chỉnh WebApp Trí tuệ nhân tạo',
        explanation: 'Bạn có thể tùy chỉnh giao diện trước của ứng dụng Web để phù hợp với kịch bản và nhu cầu phong cách của bạn.',
        way1: {
          name: 'Fork mã nguồn máy khách, chỉnh sửa và triển khai lên Vercel (được khuyến nghị)',
          step1: 'Fork mã nguồn máy khách và chỉnh sửa',
          step1Tip: 'Nhấn vào đây để fork mã nguồn vào tài khoản GitHub của bạn và chỉnh sửa mã',
          step1Operation: 'Dify-WebClient',
          step2: 'Triển khai lên Vercel',
          step2Tip: 'Nhấn vào đây để nhập kho vào Vercel và triển khai',
          step2Operation: 'Nhập kho',
          step3: 'Cấu hình biến môi trường',
          step3Tip: 'Thêm các biến môi trường sau vào Vercel',
        },
        way2: {
          name: 'Viết mã phía máy khách để gọi API và triển khai nó lên máy chủ',
          operation: 'Tài liệu',
        },
      },
    },
    apiInfo: {
      title: 'API Dịch vụ Backend',
      explanation: 'Dễ dàng tích hợp vào ứng dụng của bạn',
      accessibleAddress: 'Điểm cuối API Dịch vụ',
      doc: 'Tài liệu Tham khảo API',
    },
    status: {
      running: 'Đang hoạt động',
      disable: 'Tắt',
    },
  },
  analysis: {
    title: 'Phân tích',
    ms: 'ms',
    tokenPS: 'Token/s',
    totalMessages: {
      title: 'Tổng số tin nhắn',
      explanation: 'Số lượt tương tác AI hàng ngày; không bao gồm kỹ thuật kịch bản / gỡ lỗi.',
    },
    activeUsers: {
      title: 'Người dùng hoạt động',
      explanation: 'Người dùng duy nhất tham gia trò chuyện với AI; không bao gồm kỹ thuật kịch bản / gỡ lỗi.',
    },
    tokenUsage: {
      title: 'Sử dụng Token',
      explanation: 'Phản ánh việc sử dụng token hàng ngày của mô hình ngôn ngữ cho ứng dụng, hữu ích cho mục đích kiểm soát chi phí.',
      consumed: 'Đã tiêu',
    },
    avgSessionInteractions: {
      title: 'Trung bình Tương tác trong phiên',
      explanation: 'Số lượt giao tiếp giữa người dùng và AI liên tục; cho các ứng dụng dựa trên cuộc trò chuyện.',
    },
    userSatisfactionRate: {
      title: 'Tỷ lệ Hài lòng của Người dùng',
      explanation: 'Số lượng thích cho mỗi 1.000 tin nhắn. Điều này cho thấy tỷ lệ phản hồi mà người dùng rất hài lòng.',
    },
    avgResponseTime: {
      title: 'Trung bình Thời gian Phản hồi',
      explanation: 'Thời gian (ms) để AI xử lý / phản hồi; cho các ứng dụng dựa trên văn bản.',
    },
    tps: {
      title: 'Tốc độ Đầu ra Token',
      explanation: 'Đo hiệu suất của LLM. Đếm tốc độ đầu ra Token của LLM từ khi bắt đầu yêu cầu cho đến khi hoàn thành đầu ra.',
    },
  },
}

export default translation
