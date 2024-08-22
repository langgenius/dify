const translation = {
  knowledge: 'Kiến thức',
  documentCount: ' tài liệu',
  wordCount: ' nghìn từ',
  appCount: ' ứng dụng liên kết',
  createDataset: 'Tạo bộ kiến thức',
  createDatasetIntro: 'Nhập dữ liệu văn bản của bạn hoặc cập nhật dữ liệu theo thời gian thực qua Webhook để tăng cường ngữ cảnh cho LLM.',
  deleteDatasetConfirmTitle: 'Xóa bộ kiến thức này?',
  deleteDatasetConfirmContent:
    'Việc xóa bộ kiến thức là không thể hoàn tác. Người dùng sẽ không còn truy cập được vào bộ kiến thức của bạn, và tất cả cấu hình cùng nhật ký lời nhắc sẽ bị xóa vĩnh viễn.',
  datasetUsedByApp: 'Bộ kiến thức này đang được sử dụng bởi một số ứng dụng. Các ứng dụng sẽ không thể sử dụng bộ kiến thức này nữa, và tất cả cấu hình lời nhắc cùng nhật ký sẽ bị xóa vĩnh viễn.',
  datasetDeleted: 'Bộ kiến thức đã được xóa',
  datasetDeleteFailed: 'Xóa bộ kiến thức không thành công',
  didYouKnow: 'Bạn có biết?',
  intro1: 'Bộ kiến thức có thể được tích hợp vào ứng dụng Dify ',
  intro2: 'như một ngữ cảnh',
  intro3: ',',
  intro4: 'hoặc ',
  intro5: 'có thể được tạo',
  intro6: ' dưới dạng một plugin chỉ mục ChatGPT độc lập để xuất bản',
  unavailable: 'Không khả dụng',
  unavailableTip: 'Mô hình nhúng không khả dụng, cần cấu hình mô hình nhúng mặc định',
  datasets: 'BỘ KIẾN THỨC',
  datasetsApi: 'API',
  retrieval: {
    semantic_search: {
      title: 'Tìm kiếm Vector',
      description: 'Tạo các nhúng truy vấn và tìm kiếm đoạn văn bản tương tự nhất với biểu diễn vector của nó.',
    },
    full_text_search: {
      title: 'Tìm kiếm Toàn văn bản',
      description: 'Lập chỉ mục cho tất cả các thuật ngữ trong tài liệu, cho phép người dùng tìm kiếm bất kỳ thuật ngữ nào và truy xuất đoạn văn bản liên quan chứa các thuật ngữ đó.',
    },
    hybrid_search: {
      title: 'Tìm kiếm Kết hợp',
      description: 'Thực hiện tìm kiếm toàn văn bản và tìm kiếm vector đồng thời, sắp xếp lại để chọn kết quả phù hợp nhất với truy vấn của người dùng. Yêu cầu cấu hình API mô hình Rerank.',
      recommend: 'Đề xuất',
    },
    invertedIndex: {
      title: 'Chỉ mục Ngược',
      description: 'Chỉ mục Ngược là một cấu trúc được sử dụng cho việc truy xuất hiệu quả. Nó được tổ chức theo thuật ngữ, mỗi thuật ngữ trỏ đến tài liệu hoặc trang web chứa nó.',
    },
    change: 'Thay đổi',
    changeRetrievalMethod: 'Thay đổi phương pháp truy xuất',
  },
  docsFailedNotice: 'tài liệu không được lập chỉ mục',
  retry: 'Thử lại',
}

export default translation
