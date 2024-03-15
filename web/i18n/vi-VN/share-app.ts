const translation = {
  common: {
    welcome: 'Chào mừng đến với',
    appUnavailable: 'Ứng dụng không khả dụng',
    appUnkonwError: 'Ứng dụng không khả dụng',
  },
  chat: {
    newChat: 'Trò chuyện mới',
    pinnedTitle: 'Đã ghim',
    unpinnedTitle: 'Trò chuyện',
    newChatDefaultName: 'Cuộc trò chuyện mới',
    resetChat: 'Đặt lại cuộc trò chuyện',
    powerBy: 'Được cung cấp bởi',
    prompt: 'Lời nhắc',
    privatePromptConfigTitle: 'Cài đặt cuộc trò chuyện',
    publicPromptConfigTitle: 'Lời nhắc ban đầu',
    configStatusDes: 'Trước khi bắt đầu, bạn có thể chỉnh sửa cài đặt cuộc trò chuyện',
    configDisabled:
      'Cài đặt của phiên trước đã được sử dụng cho phiên này.',
    startChat: 'Bắt đầu trò chuyện',
    privacyPolicyLeft:
      'Vui lòng đọc ',
    privacyPolicyMiddle:
      'chính sách bảo mật',
    privacyPolicyRight:
      ' được cung cấp bởi nhà phát triển ứng dụng.',
    deleteConversation: {
      title: 'Xóa cuộc trò chuyện',
      content: 'Bạn có chắc muốn xóa cuộc trò chuyện này không?',
    },
    tryToSolve: 'Thử giải quyết',
    temporarySystemIssue: 'Xin lỗi, có sự cố tạm thời của hệ thống.',
  },
  generation: {
    tabs: {
      create: 'Chạy Một lần',
      batch: 'Chạy Theo Lô',
      saved: 'Đã Lưu',
    },
    savedNoData: {
      title: 'Bạn chưa lưu kết quả nào!',
      description: 'Bắt đầu tạo nội dung và tìm kết quả đã lưu của bạn ở đây.',
      startCreateContent: 'Bắt đầu tạo nội dung',
    },
    title: 'Hoàn Thiện AI',
    queryTitle: 'Nội dung truy vấn',
    completionResult: 'Kết quả hoàn thiện',
    queryPlaceholder: 'Viết nội dung truy vấn của bạn...',
    run: 'Thực thi',
    copy: 'Sao chép',
    resultTitle: 'Hoàn Thiện AI',
    noData: 'AI sẽ đưa ra điều bạn muốn ở đây.',
    csvUploadTitle: 'Kéo và thả tệp CSV của bạn vào đây, hoặc ',
    browse: 'duyệt',
    csvStructureTitle: 'Tệp CSV phải tuân thủ cấu trúc sau:',
    downloadTemplate: 'Tải xuống mẫu tại đây',
    field: 'Trường',
    batchFailed: {
      info: '{{num}} thực thi thất bại',
      retry: 'Thử lại',
      outputPlaceholder: 'Không có nội dung đầu ra',
    },
    errorMsg: {
      empty: 'Vui lòng nhập nội dung vào tệp đã tải lên.',
      fileStructNotMatch: 'Tệp CSV tải lên không khớp cấu trúc.',
      emptyLine: 'Hàng {{rowIndex}} trống',
      invalidLine: 'Hàng {{rowIndex}}: {{varName}} không thể để trống',
      moreThanMaxLengthLine: 'Hàng {{rowIndex}}: {{varName}} không thể chứa nhiều hơn {{maxLength}} ký tự',
      atLeastOne: 'Vui lòng nhập ít nhất một hàng vào tệp đã tải lên.',
    },
  },
}

export default translation
