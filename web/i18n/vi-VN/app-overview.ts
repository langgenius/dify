const translation = {
  welcome: {
    firstStepTip: 'Để bắt đầu,',
    enterKeyTip: 'nhập khóa API OpenAI của bạn bên dưới',
    getKeyTip: 'Lấy API Key của bạn từ bảng điều khiển OpenAI',
    placeholder: 'Khóa API OpenAI của bạn (vd. sk-xxxx)',
  },
  apiKeyInfo: {
    cloud: {
      trial: {
        title: 'Bạn đang sử dụng hạn mức thử nghiệm của {{providerName}}.',
        description: 'Hạn mức thử nghiệm được cung cấp cho việc kiểm tra của bạn. Trước khi hết lượt gọi hạn mức thử nghiệm, vui lòng thiết lập nhà cung cấp mô hình của riêng bạn hoặc mua thêm hạn mức.',
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
    tryCloud: 'Hoặc thử phiên bản điện toán đám mây của Dify với báo giá miễn phí',
  },
  overview: {
    title: 'Tổng quan',
    appInfo: {
      explanation: 'Ứng dụng web AI sẵn sàng sử dụng',
      accessibleAddress: 'Địa chỉ công cộng',
      preview: 'Xem trước',
      regenerate: 'Tạo lại',
      regenerateNotice: 'Bạn có muốn tạo lại địa chỉ công cộng không?',
      preUseReminder: 'Vui lòng kích hoạt ứng dụng web trước khi tiếp tục.',
      settings: {
        entry: 'Cài đặt',
        title: 'Cài đặt ứng dụng web',
        webName: 'Tên ứng dụng web',
        webDesc: 'Mô tả ứng dụng web',
        webDescTip: 'Văn bản này sẽ được hiển thị ở phía máy khách, cung cấp hướng dẫn cơ bản về cách sử dụng ứng dụng',
        webDescPlaceholder: 'Nhập mô tả của ứng dụng web',
        language: 'Ngôn ngữ',
        workflow: {
          title: 'Các Bước Quy trình',
          show: 'Hiển thị',
          hide: 'Ẩn',
        },
        more: {
          entry: 'Hiển thị thêm cài đặt',
          copyright: 'Bản quyền',
          copyRightPlaceholder: 'Nhập tên tác giả hoặc tổ chức',
          privacyPolicy: 'Chính sách bảo mật',
          privacyPolicyPlaceholder: 'Nhập liên kết chính sách bảo mật',
          privacyPolicyTip: 'Giúp khách truy cập hiểu được dữ liệu mà ứng dụng thu thập, xem <privacyPolicyLink>Chính sách bảo mật</privacyPolicyLink> của Dify.',
          customDisclaimer: 'Tùy chỉnh từ chối trách nhiệm',
          customDisclaimerPlaceholder: 'Nhập liên kết từ chối trách nhiệm',
          customDisclaimerTip: 'Liên kết này sẽ được hiển thị ở phía máy khách, cung cấp thông tin về trách nhiệm của ứng dụng',
        },
      },
      embedded: {
        entry: 'Nhúng',
        title: 'Nhúng vào trang web',
        explanation: 'Chọn cách nhúng ứng dụng trò chuyện vào trang web của bạn',
        iframe: 'Để thêm ứng dụng trò chuyện ở bất kỳ đâu trên trang web của bạn, hãy thêm iframe này vào mã HTML của bạn.',
        scripts: 'Để thêm ứng dụng trò chuyện vào góc dưới bên phải của trang web của bạn, thêm mã này vào mã HTML của bạn.',
        chromePlugin: 'Cài đặt Tiện ích Mở rộng Dify Chatbot cho Chrome',
        copied: 'Đã sao chép',
        copy: 'Sao chép',
      },
      qrcode: {
        title: 'Mã QR để chia sẻ',
        scan: 'Quét và Chia sẻ Ứng dụng',
        download: 'Tải xuống Mã QR',
      },
      customize: {
        way: 'cách',
        entry: 'Tùy chỉnh',
        title: 'Tùy chỉnh ứng dụng web AI',
        explanation: 'Bạn có thể tùy chỉnh giao diện phía trước của Ứng dụng Web để phù hợp với kịch bản và nhu cầu phong cách của mình.',
        way1: {
          name: 'Fork mã nguồn của máy khách, sửa đổi và triển khai lên Vercel (được khuyến nghị)',
          step1: 'Fork mã nguồn của máy khách và sửa đổi',
          step1Tip: 'Nhấp vào đây để fork mã nguồn vào tài khoản GitHub của bạn và sửa đổi mã',
          step1Operation: 'Dify-WebClient',
          step2: 'Triển khai lên Vercel',
          step2Tip: 'Nhấp vào đây để nhập kho vào Vercel và triển khai',
          step2Operation: 'Nhập kho',
          step3: 'Cấu hình biến môi trường',
          step3Tip: 'Thêm các biến môi trường sau vào Vercel',
        },
        way2: {
          name: 'Viết mã phía máy khách để gọi API và triển khai lên một máy chủ',
          operation: 'Tài liệu',
        },
      },
    },
    apiInfo: {
      title: 'API Dịch vụ Backend',
      explanation: 'Dễ dàng tích hợp vào ứng dụng của bạn',
      accessibleAddress: 'Điểm cuối Dịch vụ API',
      doc: 'Tài liệu tham khảo API',
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
      title: 'Tổng Số Tin Nhắn',
      explanation: 'Số lần tương tác AI hàng ngày; không tính việc kỹ thuật hóa/nhái lại câu hỏi.',
    },
    activeUsers: {
      title: 'Người Dùng Hoạt Động',
      explanation: 'Người dùng duy nhất tham gia trò chuyện với AI; không tính việc kỹ thuật hóa/nhái lại câu hỏi.',
    },
    tokenUsage: {
      title: 'Sử Dụng Token',
      explanation: 'Phản ánh việc sử dụng hàng ngày của mô hình ngôn ngữ cho ứng dụng, hữu ích cho mục đích kiểm soát chi phí.',
      consumed: 'Đã Sử Dụng',
    },
    avgSessionInteractions: {
      title: 'Trung Bình Tương Tác Phiên',
      explanation: 'Số lần giao tiếp liên tục giữa người dùng và AI; cho các ứng dụng dựa trên cuộc trò chuyện.',
    },
    avgUserInteractions: {
      title: 'Trung Bình Tương Tác Người Dùng',
      explanation: 'Phản ánh tần suất sử dụng hàng ngày của người dùng. Số liệu này phản ánh sự kết dính của người dùng.',
    },
    userSatisfactionRate: {
      title: 'Tỷ Lệ Hài Lòng của Người Dùng',
      explanation: 'Số lượt thích trên mỗi 1.000 tin nhắn. Điều này cho biết tỷ lệ câu trả lời mà người dùng rất hài lòng.',
    },
    avgResponseTime: {
      title: 'Thời Gian Trả Lời Trung Bình',
      explanation: 'Thời gian (ms) để AI xử lý/phản hồi; cho các ứng dụng dựa trên văn bản.',
    },
    tps: {
      title: 'Tốc Độ Đầu Ra Token',
      explanation: 'Đo lường hiệu suất của LLM. Đếm tốc độ đầu ra Token của LLM từ khi bắt đầu yêu cầu đến khi hoàn thành đầu ra.',
    },
  },
}

export default translation
