const translation = {
  title: 'Nhật ký',
  description: 'Nhật ký ghi lại trạng thái hoạt động của ứng dụng, bao gồm đầu vào của người dùng và phản hồi của trí tuệ nhân tạo.',
  dateTimeFormat: 'MM/DD/YYYY hh:mm A',
  table: {
    header: {
      time: 'Thời gian',
      endUser: 'Người dùng cuối',
      input: 'Đầu vào',
      output: 'Đầu ra',
      summary: 'Tiêu đề',
      messageCount: 'Số lượng tin nhắn',
      userRate: 'Tỷ lệ người dùng',
      adminRate: 'Tỷ lệ quản trị',
    },
    pagination: {
      previous: 'Trước',
      next: 'Tiếp',
    },
    empty: {
      noChat: 'Chưa có cuộc trò chuyện',
      noOutput: 'Không có đầu ra',
      element: {
        title: 'Có ai ở đó không?',
        content: 'Quan sát và ghi chú các tương tác giữa người dùng cuối và ứng dụng trí tuệ nhân tạo ở đây để liên tục cải thiện độ chính xác của trí tuệ nhân tạo. Bạn có thể thử <shareLink>chia sẻ</shareLink> hoặc <testLink>kiểm tra</testLink> ứng dụng Web của mình, sau đó quay lại trang này.',
      },
    },
  },
  detail: {
    time: 'Thời gian',
    conversationId: 'ID Cuộc trò chuyện',
    promptTemplate: 'Mẫu Nhắc nhở',
    promptTemplateBeforeChat: 'Mẫu Nhắc nhở Trước Cuộc trò chuyện · Như Tin nhắn Hệ thống',
    annotationTip: 'Cải thiện Được Đánh Dấu bởi {{user}}',
    timeConsuming: '',
    second: 'giây',
    tokenCost: 'Token đã tiêu',
    loading: 'đang tải',
    operation: {
      like: 'thích',
      dislike: 'không thích',
      addAnnotation: 'Thêm Cải thiện',
      editAnnotation: 'Chỉnh sửa Cải thiện',
      annotationPlaceholder: 'Nhập câu trả lời mong muốn mà bạn muốn trí tuệ nhân tạo trả lời, có thể được sử dụng cho việc điều chỉnh mô hình và cải thiện liên tục chất lượng tạo văn bản trong tương lai.',
    },
    variables: 'Biến',
    uploadImages: 'Ảnh đã tải lên',
  },
  filter: {
    period: {
      today: 'Hôm nay',
      last7days: '7 Ngày qua',
      last4weeks: '4 Tuần qua',
      last3months: '3 Tháng qua',
      last12months: '12 Tháng qua',
      monthToDate: 'Từ Đầu tháng đến nay',
      quarterToDate: 'Từ Đầu quý đến nay',
      yearToDate: 'Từ Đầu năm đến nay',
      allTime: 'Tất cả thời gian',
    },
    annotation: {
      all: 'Tất cả',
      annotated: 'Cải thiện Đã Đánh Dấu ({{count}} mục)',
      not_annotated: 'Chưa Đánh Dấu',
    },
  },
}

export default translation
