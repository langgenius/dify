const translation = {
  subscription: {
    title: 'Đăng ký',
    listNum: 'Đăng ký {{num}}',
    empty: {
      title: 'Không có đăng ký',
      button: 'Đăng ký mới',
    },
    createButton: {
      oauth: 'Đăng ký mới với OAuth',
      apiKey: 'Đăng ký mới với Khóa API',
      manual: 'Dán URL để tạo đăng ký mới',
    },
    createSuccess: 'Đăng ký đã được tạo thành công',
    createFailed: 'Tạo đăng ký thất bại',
    maxCount: 'Tối đa {{num}} lượt đăng ký',
    selectPlaceholder: 'Chọn gói đăng ký',
    noSubscriptionSelected: 'Chưa chọn gói đăng ký',
    subscriptionRemoved: 'Đã hủy đăng ký',
    list: {
      title: 'Đăng ký',
      addButton: 'Thêm',
      tip: 'Nhận sự kiện qua Đăng ký',
      item: {
        enabled: 'Đã bật',
        disabled: 'Vô hiệu hóa',
        credentialType: {
          api_key: 'Khóa API',
          oauth2: 'OAuth',
          unauthorized: 'Hướng dẫn',
        },
        actions: {
          delete: 'Xóa',
          deleteConfirm: {
            title: 'Xóa {{name}}?',
            success: 'Đăng ký {{name}} đã được xóa thành công',
            error: 'Không thể xóa đăng ký {{name}}',
            content: 'Một khi đã xóa, gói đăng ký này sẽ không thể phục hồi. Vui lòng xác nhận.',
            contentWithApps: 'Gói đăng ký hiện tại đang được {{count}} ứng dụng tham chiếu. Xóa nó sẽ khiến các ứng dụng đã cấu hình ngừng nhận các sự kiện từ gói đăng ký.',
            confirm: 'Xác nhận xóa',
            cancel: 'Hủy',
            confirmInputWarning: 'Vui lòng nhập tên chính xác để xác nhận.',
            confirmInputPlaceholder: 'Nhập "{{name}}" để xác nhận.',
            confirmInputTip: 'Vui lòng nhập “{{name}}” để xác nhận.',
          },
        },
        status: {
          active: 'Hoạt động',
          inactive: 'Không hoạt động',
        },
        usedByNum: 'Được sử dụng bởi {{num}} quy trình làm việc',
        noUsed: 'Không sử dụng quy trình công việc',
      },
    },
    addType: {
      title: 'Thêm đăng ký',
      description: 'Chọn cách bạn muốn tạo đăng ký trình kích hoạt của mình',
      options: {
        apikey: {
          title: 'Tạo bằng Khóa API',
          description: 'Tự động tạo đăng ký bằng thông tin xác thực API',
        },
        oauth: {
          title: 'Tạo bằng OAuth',
          description: 'Ủy quyền với nền tảng bên thứ ba để tạo đăng ký',
          clientSettings: 'Cài đặt khách hàng OAuth',
          clientTitle: 'Khách hàng OAuth',
          default: 'Mặc định',
          custom: 'Tùy chỉnh',
        },
        manual: {
          title: 'Cài đặt thủ công',
          description: 'Dán URL để tạo đăng ký mới',
          tip: 'Cấu hình URL trên nền tảng của bên thứ ba thủ công',
        },
      },
    },
  },
  modal: {
    steps: {
      verify: 'Xác minh',
      configuration: 'Cấu hình',
    },
    common: {
      cancel: 'Hủy',
      back: 'Quay lại',
      next: 'Tiếp theo',
      create: 'Tạo',
      verify: 'Xác minh',
      authorize: 'Ủy quyền',
      creating: 'Đang tạo...',
      verifying: 'Đang xác minh...',
      authorizing: 'Đang cấp quyền...',
    },
    oauthRedirectInfo: 'Vì không tìm thấy bí mật khách hàng hệ thống cho nhà cung cấp công cụ này, cần phải thiết lập thủ công, đối với redirect_uri, vui lòng sử dụng',
    apiKey: {
      title: 'Tạo bằng Khóa API',
      verify: {
        title: 'Xác minh thông tin đăng nhập',
        description: 'Vui lòng cung cấp thông tin xác thực API của bạn để xác minh quyền truy cập',
        error: 'Xác minh thông tin không thành công. Vui lòng kiểm tra lại khóa API của bạn.',
        success: 'Thông tin đăng nhập đã được xác minh thành công',
      },
      configuration: {
        title: 'Cấu hình đăng ký',
        description: 'Thiết lập các tham số đăng ký của bạn',
      },
    },
    oauth: {
      title: 'Tạo bằng OAuth',
      authorization: {
        title: 'Ủy quyền OAuth',
        description: 'Cho phép Dify truy cập vào tài khoản của bạn',
        redirectUrl: 'Chuyển hướng URL',
        redirectUrlHelp: 'Sử dụng URL này trong cấu hình ứng dụng OAuth của bạn',
        authorizeButton: 'Ủy quyền với {{provider}}',
        waitingAuth: 'Đang chờ cấp quyền...',
        authSuccess: 'Ủy quyền thành công',
        authFailed: 'Không thể lấy thông tin xác thực OAuth',
        waitingJump: 'Được phép, đang chờ nhảy',
      },
      configuration: {
        title: 'Cấu hình đăng ký',
        description: 'Thiết lập các thông số đăng ký của bạn sau khi được cấp quyền',
        success: 'Cấu hình OAuth thành công',
        failed: 'Cấu hình OAuth thất bại',
      },
      remove: {
        success: 'Xóa OAuth thành công',
        failed: 'Xóa OAuth thất bại',
      },
      save: {
        success: 'Cấu hình OAuth đã được lưu thành công',
      },
    },
    manual: {
      title: 'Cài đặt thủ công',
      description: 'Cấu hình đăng ký webhook của bạn thủ công',
      logs: {
        title: 'Nhật ký yêu cầu',
        request: 'Yêu cầu',
        loading: 'Đang chờ yêu cầu từ {{pluginName}}...',
      },
    },
    form: {
      subscriptionName: {
        label: 'Tên thuê bao',
        placeholder: 'Nhập tên gói đăng ký',
        required: 'Tên đăng ký là bắt buộc',
      },
      callbackUrl: {
        label: 'URL gọi lại',
        description: 'URL này sẽ nhận các sự kiện webhook',
        tooltip: 'Cung cấp một endpoint có thể truy cập công khai để nhận các yêu cầu gọi lại từ nhà cung cấp kích hoạt.',
        placeholder: 'Đang tạo...',
        privateAddressWarning: 'URL này có vẻ là một địa chỉ nội bộ, điều này có thể khiến các yêu cầu webhook thất bại. Bạn có thể thay đổi TRIGGER_URL sang một địa chỉ công khai.',
      },
    },
    errors: {
      createFailed: 'Tạo đăng ký thất bại',
      verifyFailed: 'Xác minh thông tin đăng nhập thất bại',
      authFailed: 'Ủy quyền thất bại',
      networkError: 'Lỗi mạng, vui lòng thử lại',
    },
  },
  events: {
    title: 'Các sự kiện có sẵn',
    description: 'Các sự kiện mà plugin kích hoạt này có thể đăng ký',
    empty: 'Không có sự kiện nào',
    event: 'Sự kiện',
    events: 'Sự kiện',
    actionNum: '{{num}} {{event}} ĐÃ BAO GỒM',
    item: {
      parameters: 'tham số {{count}}',
      noParameters: 'Không có tham số',
    },
    output: 'Đầu ra',
  },
  node: {
    status: {
      warning: 'Ngắt kết nối',
    },
  },
}

export default translation
