const translation = {
  title: 'Kiểm tra truy vấn',
  desc: 'Kiểm tra hiệu quả truy xuất của Kiến thức dựa trên văn bản truy vấn đã cho.',
  dateTimeFormat: 'MM/DD/YYYY hh:mm A',
  table: {
    header: {
      source: 'Nguồn',
      time: 'Thời gian',
      queryContent: 'Nội dung truy vấn',
    },
  },
  input: {
    title: 'Văn bản nguồn',
    placeholder: 'Vui lòng nhập một văn bản, khuyến nghị sử dụng một câu khẳng định ngắn.',
    countWarning: 'Tối đa 200 ký tự.',
    indexWarning: 'Chỉ có sẵn trong Kiến thức chất lượng cao.',
    testing: 'Đang kiểm tra',
  },
  hit: {
    title: 'CÁC ĐOẠN VĂN ĐƯỢC TRUY XUẤT',
    emptyTip: 'Kết quả kiểm tra truy vấn sẽ hiển thị ở đây',
  },
  noRecentTip: 'Không có kết quả truy vấn gần đây',
  viewChart: 'Xem BIỂU ĐỒ VECTOR',
  settingTitle: 'Cài đặt truy xuất',
  viewDetail: 'Xem chi tiết',
  records: 'Hồ sơ',
  open: 'Mở',
  keyword: 'Từ khoá',
  hitChunks: 'Nhấn {{num}} đoạn con',
  chunkDetail: 'Chi tiết khối',
  imageUploader: {
    tip: 'Tải lên hoặc thả hình ảnh (Tối đa {{batchCount}}, {{size}}MB mỗi ảnh)',
    tooltip: 'Tải hình ảnh lên (Tối đa {{batchCount}}, {{size}}MB mỗi ảnh)',
    dropZoneTip: 'Kéo tệp vào đây để tải lên',
    singleChunkAttachmentLimitTooltip: 'Số lượng phụ kiện khối đơn không được vượt quá {{limit}}',
  },
}

export default translation
