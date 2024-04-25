const translation = {
  knowledge: 'Kiến thức',
  documentCount: ' tài liệu',
  wordCount: ' k từ',
  appCount: ' ứng dụng liên kết',
  createDataset: 'Tạo Kiến thức',
  createDatasetIntro: 'Nhập dữ liệu văn bản của bạn hoặc viết dữ liệu theo thời gian thực qua Webhook để tăng cường ngữ cảnh LLM.',
  deleteDatasetConfirmTitle: 'Xóa Kiến thức này?',
  deleteDatasetConfirmContent:
    'Xóa Kiến thức là không thể đảo ngược. Người dùng sẽ không còn có khả năng truy cập Kiến thức của bạn nữa, và tất cả các cấu hình và nhật ký nhắc nhở sẽ bị xóa vĩnh viễn.',
  datasetDeleted: 'Kiến thức đã bị xóa',
  datasetDeleteFailed: 'Xóa Kiến thức không thành công',
  didYouKnow: 'Bạn đã biết chưa?',
  intro1: 'Kiến thức có thể được tích hợp vào ứng dụng Dify ',
  intro2: 'như một ngữ cảnh',
  intro3: ',',
  intro4: 'hoặc nó ',
  intro5: 'có thể được tạo',
  intro6: ' dưới dạng một phần cắm chỉ mục ChatGPT độc lập để xuất bản',
  unavailable: 'Không khả dụng',
  unavailableTip: 'Mô hình nhúng không khả dụng, mô hình nhúng mặc định cần được cấu hình',
  datasets: 'KIẾN THỨC',
  datasetsApi: 'API',
  retrieval: {
    semantic_search: {
      title: 'Tìm kiếm Vector',
      description: 'Tạo các nhúng truy vấn và tìm kiếm phần văn bản giống nhất với biểu diễn vector của nó.',
    },
    full_text_search: {
      title: 'Tìm kiếm Toàn văn bản',
      description: 'Chỉ mục tất cả các thuật ngữ trong tài liệu, cho phép người dùng tìm kiếm bất kỳ thuật ngữ nào và truy xuất phần văn bản liên quan chứa các thuật ngữ đó.',
    },
    hybrid_search: {
      title: 'Tìm kiếm Hybrid',
      description: 'Thực hiện tìm kiếm toàn văn bản và tìm kiếm vector đồng thời, sắp xếp lại để chọn lựa phù hợp nhất với truy vấn của người dùng. Cấu hình của API mô hình Rerank là cần thiết.',
      recommend: 'Gợi ý',
    },
    invertedIndex: {
      title: 'Chỉ mục Nghịch đảo',
      description: 'Chỉ mục Nghịch đảo là một cấu trúc được sử dụng cho việc truy xuất hiệu quả. Tổ chức theo thuật ngữ, mỗi thuật ngữ trỏ đến tài liệu hoặc trang web chứa nó.',
    },
    change: 'Thay đổi',
    changeRetrievalMethod: 'Thay đổi phương pháp truy xuất',
  },
  docsFailedNotice: 'tài liệu không được lập chỉ mục',
  retry: 'Thử lại',
}

export default translation
