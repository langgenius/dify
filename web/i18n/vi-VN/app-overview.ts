const translation = {
  welcome: {
    firstStepTip: 'Để bắt đầu,',
    enterKeyTip: 'nhập khóa API OpenAI của bạn bên dưới',
    getKeyTip: 'Lấy khóa API từ bảng điều khiển OpenAI',
    placeholder: 'Khóa API OpenAI của bạn (ví dụ: sk-xxxx)',
  },
  apiKeyInfo: {
    cloud: {
      trial: {
        title: 'Bạn đang sử dụng gói dùng thử của {{providerName}}.',
        description: 'Gói dùng thử được cung cấp để bạn kiểm tra. Trước khi hết lượt gọi của gói dùng thử, vui lòng thiết lập nhà cung cấp mô hình riêng hoặc mua thêm hạn mức.',
      },
      exhausted: {
        title: 'Gói dùng thử của bạn đã hết, vui lòng thiết lập khóa API của bạn.',
        description: 'Gói dùng thử của bạn đã hết. Vui lòng thiết lập nhà cung cấp mô hình riêng hoặc mua thêm hạn mức.',
      },
    },
    selfHost: {
      title: {
        row1: 'Để bắt đầu,',
        row2: 'hãy thiết lập nhà cung cấp mô hình của bạn trước.',
      },
    },
    callTimes: 'Số lần gọi',
    usedToken: 'Token đã sử dụng',
    setAPIBtn: 'Thiết lập nhà cung cấp mô hình',
    tryCloud: 'Hoặc dùng thử phiên bản đám mây của Dify với gói miễn phí',
  },
  overview: {
    title: 'Tổng quan',
    appInfo: {
      explanation: 'Ứng dụng web AI sẵn sàng sử dụng',
      accessibleAddress: 'Địa chỉ công khai',
      preview: 'Xem trước',
      regenerate: 'Tạo lại',
      regenerateNotice: 'Bạn có muốn tạo lại địa chỉ công khai không?',
      preUseReminder: 'Vui lòng kích hoạt ứng dụng web trước khi tiếp tục.',
      settings: {
        entry: 'Cài đặt',
        title: 'Cài đặt ứng dụng web',
        webName: 'Tên ứng dụng web',
        webDesc: 'Mô tả ứng dụng web',
        webDescTip: 'Văn bản này sẽ hiển thị ở phía người dùng, cung cấp hướng dẫn cơ bản về cách sử dụng ứng dụng',
        webDescPlaceholder: 'Nhập mô tả của ứng dụng web',
        language: 'Ngôn ngữ',
        workflow: {
          title: 'Các bước quy trình',
          show: 'Hiển thị',
          hide: 'Ẩn',
          showDesc: 'Hiển thị hoặc ẩn chi tiết dòng công việc trong WebApp',
          subTitle: 'Chi tiết quy trình làm việc',
        },
        chatColorTheme: 'Giao diện màu trò chuyện',
        chatColorThemeDesc: 'Thiết lập giao diện màu của chatbot',
        chatColorThemeInverted: 'Đảo ngược',
        invalidHexMessage: 'Giá trị mã màu không hợp lệ',
        more: {
          entry: 'Hiển thị thêm cài đặt',
          copyright: 'Bản quyền',
          copyRightPlaceholder: 'Nhập tên tác giả hoặc tổ chức',
          privacyPolicy: 'Chính sách bảo mật',
          privacyPolicyPlaceholder: 'Nhập liên kết chính sách bảo mật',
          privacyPolicyTip: 'Giúp người dùng hiểu dữ liệu mà ứng dụng thu thập, xem <privacyPolicyLink>Chính sách bảo mật</privacyPolicyLink> của Dify.',
          customDisclaimer: 'Tuyên bố từ chối trách nhiệm tùy chỉnh',
          customDisclaimerPlaceholder: 'Nhập liên kết tuyên bố từ chối trách nhiệm',
          customDisclaimerTip: 'Liên kết này sẽ hiển thị ở phía người dùng, cung cấp thông tin về trách nhiệm của ứng dụng',
          copyrightTip: 'Hiển thị thông tin bản quyền trong ứng dụng web',
          copyrightTooltip: 'Vui lòng nâng cấp lên gói Professional trở lên',
        },
        sso: {
          title: 'SSO ứng dụng web',
          description: 'Tất cả người dùng được yêu cầu đăng nhập bằng SSO trước khi sử dụng WebApp',
          tooltip: 'Liên hệ với quản trị viên để bật SSO WebApp',
          label: 'Xác thực SSO',
        },
        modalTip: 'Cài đặt ứng dụng web phía máy khách.',
      },
      embedded: {
        entry: 'Nhúng',
        title: 'Nhúng vào trang web',
        explanation: 'Chọn cách nhúng ứng dụng trò chuyện vào trang web của bạn',
        iframe: 'Để thêm ứng dụng trò chuyện vào bất kỳ đâu trên trang web của bạn, hãy thêm iframe này vào mã HTML của bạn.',
        scripts: 'Để thêm ứng dụng trò chuyện vào góc dưới bên phải của trang web, thêm mã này vào mã HTML của bạn.',
        chromePlugin: 'Cài đặt tiện ích mở rộng Dify Chatbot cho Chrome',
        copied: 'Đã sao chép',
        copy: 'Sao chép',
      },
      qrcode: {
        title: 'Mã QR để chia sẻ',
        scan: 'Quét và chia sẻ ứng dụng',
        download: 'Tải xuống mã QR',
      },
      customize: {
        way: 'cách',
        entry: 'Tùy chỉnh',
        title: 'Tùy chỉnh ứng dụng web AI',
        explanation: 'Bạn có thể tùy chỉnh giao diện của ứng dụng web để phù hợp với kịch bản và phong cách mong muốn.',
        way1: {
          name: 'Fork mã nguồn phía client, sửa đổi và triển khai lên Vercel (khuyến nghị)',
          step1: 'Fork mã nguồn phía client và sửa đổi',
          step1Tip: 'Nhấp vào đây để fork mã nguồn vào tài khoản GitHub của bạn và sửa đổi',
          step1Operation: 'Dify-WebClient',
          step2: 'Triển khai lên Vercel',
          step2Tip: 'Nhấp vào đây để nhập kho lưu trữ vào Vercel và triển khai',
          step2Operation: 'Nhập kho lưu trữ',
          step3: 'Cấu hình biến môi trường',
          step3Tip: 'Thêm các biến môi trường sau vào Vercel',
        },
        way2: {
          name: 'Viết mã phía client để gọi API và triển khai lên máy chủ',
          operation: 'Tài liệu',
        },
      },
      launch: 'Phóng',
    },
    apiInfo: {
      title: 'API dịch vụ backend',
      explanation: 'Dễ dàng tích hợp vào ứng dụng của bạn',
      accessibleAddress: 'Điểm cuối dịch vụ API',
      doc: 'Tài liệu tham khảo API',
    },
    status: {
      running: 'Đang hoạt động',
      disable: 'Đã tắt',
    },
  },
  analysis: {
    title: 'Phân tích',
    ms: 'ms',
    tokenPS: 'Token/giây',
    totalMessages: {
      title: 'Tổng số tin nhắn',
      explanation: 'Số lượng tương tác AI hàng ngày.',
    },
    totalConversations: {
      title: 'Tổng số cuộc hội thoại',
      explanation: 'Số lượng cuộc hội thoại AI hàng ngày; không bao gồm kỹ thuật/gỡ lỗi prompt.',
    },
    activeUsers: {
      title: 'Người dùng hoạt động',
      explanation: 'Số người dùng duy nhất tham gia trò chuyện với AI; không tính việc tạo lại/lặp lại câu hỏi.',
    },
    tokenUsage: {
      title: 'Sử dụng token',
      explanation: 'Phản ánh việc sử dụng mô hình ngôn ngữ hàng ngày cho ứng dụng, hữu ích cho mục đích kiểm soát chi phí.',
      consumed: 'Đã sử dụng',
    },
    avgSessionInteractions: {
      title: 'Trung bình tương tác mỗi phiên',
      explanation: 'Số lần giao tiếp liên tục giữa người dùng và AI; áp dụng cho các ứng dụng dựa trên trò chuyện.',
    },
    avgUserInteractions: {
      title: 'Trung bình tương tác mỗi người dùng',
      explanation: 'Phản ánh tần suất sử dụng hàng ngày của người dùng. Chỉ số này cho biết mức độ gắn kết của người dùng.',
    },
    userSatisfactionRate: {
      title: 'Tỷ lệ hài lòng của người dùng',
      explanation: 'Số lượt thích trên mỗi 1.000 tin nhắn. Chỉ số này cho biết tỷ lệ câu trả lời mà người dùng rất hài lòng.',
    },
    avgResponseTime: {
      title: 'Thời gian phản hồi trung bình',
      explanation: 'Thời gian (ms) để AI xử lý/phản hồi; áp dụng cho các ứng dụng dựa trên văn bản.',
    },
    tps: {
      title: 'Tốc độ đầu ra token',
      explanation: 'Đo lường hiệu suất của LLM. Đếm tốc độ đầu ra token của LLM từ khi bắt đầu yêu cầu đến khi hoàn thành đầu ra.',
    },
  },
}

export default translation
