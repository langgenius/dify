const translation = {
  creation: {
    createFromScratch: {
      title: 'Quy trình kiến thức trống',
      description: 'Tạo quy trình tùy chỉnh từ đầu với toàn quyền kiểm soát cấu trúc và xử lý dữ liệu.',
    },
    backToKnowledge: 'Quay lại kiến thức',
    caution: 'Thận trọng',
    importDSL: 'Nhập từ tệp DSL',
    createKnowledge: 'Tạo kiến thức',
    errorTip: 'Không thể tạo Cơ sở kiến thức',
    successTip: 'Tạo thành công Cơ sở tri thức',
  },
  templates: {
    customized: 'Tùy chỉnh',
  },
  operations: {
    process: 'Quá trình',
    choose: 'Chọn',
    preview: 'Download',
    backToDataSource: 'Quay lại nguồn dữ liệu',
    details: 'Chi tiết',
    dataSource: 'Nguồn dữ liệu',
    editInfo: 'Chỉnh sửa thông tin',
    exportPipeline: 'Đường ống xuất khẩu',
    saveAndProcess: 'Lưu & xử lý',
    useTemplate: 'Sử dụng quy trình kiến thức này',
    convert: 'Convert',
  },
  deletePipeline: {
    content: 'Xóa mẫu quy trình là không thể đảo ngược.',
    title: 'Bạn có chắc chắn xóa mẫu quy trình này không?',
  },
  publishPipeline: {
    success: {
      message: 'Knowledge Pipeline đã xuất bản',
    },
    error: {
      message: 'Không thể xuất bản quy trình kiến thức',
    },
  },
  publishTemplate: {
    success: {
      learnMore: 'Tìm hiểu thêm',
      message: 'Mẫu đường ống đã được xuất bản',
      tip: 'Bạn có thể sử dụng mẫu này trên trang tạo.',
    },
    error: {
      message: 'Không xuất bản được mẫu quy trình',
    },
  },
  exportDSL: {
    successTip: 'Xuất DSL quy trình thành công',
    errorTip: 'Không thể xuất DSL đường ống',
  },
  details: {
    structure: 'Cấu trúc',
    structureTooltip: 'Chunk Structure xác định cách các tài liệu được phân tách và lập chỉ mục — cung cấp các chế độ General, Parent-Child và Q&A — và là duy nhất cho mỗi cơ sở tri thức.',
  },
  testRun: {
    steps: {
      dataSource: 'Nguồn dữ liệu',
      documentProcessing: 'Xử lý tài liệu',
    },
    dataSource: {
      localFiles: 'Tệp cục bộ',
    },
    notion: {
      docTitle: 'Tài liệu Notion',
      title: 'Chọn trang Notion',
    },
    title: 'Chạy thử',
    tooltip: 'Ở chế độ chạy thử, chỉ được phép nhập một tài liệu tại một thời điểm để gỡ lỗi và quan sát dễ dàng hơn.',
  },
  inputFieldPanel: {
    uniqueInputs: {
      title: 'Đầu vào duy nhất cho mỗi lối vào',
      tooltip: 'Đầu vào duy nhất chỉ có thể truy cập được vào nguồn dữ liệu đã chọn và các nút xuôi dòng của nó. Người dùng sẽ không cần phải điền vào nó khi chọn các nguồn dữ liệu khác. Chỉ các trường đầu vào được tham chiếu bởi các biến nguồn dữ liệu sẽ xuất hiện trong bước đầu tiên (Nguồn dữ liệu). Tất cả các trường khác sẽ được hiển thị trong bước thứ hai (Tài liệu xử lý).',
    },
    globalInputs: {
      title: 'Đầu vào toàn cầu cho tất cả các lối vào',
      tooltip: 'Đầu vào toàn cầu được chia sẻ trên tất cả các nút. Người dùng sẽ cần điền chúng khi chọn bất kỳ nguồn dữ liệu nào. Ví dụ: các trường như dấu phân cách và độ dài khối tối đa có thể được áp dụng đồng nhất trên nhiều nguồn dữ liệu. Chỉ các trường đầu vào được tham chiếu bởi các biến Nguồn dữ liệu mới xuất hiện trong bước đầu tiên (Nguồn dữ liệu). Tất cả các trường khác hiển thị trong bước thứ hai (Tài liệu xử lý).',
    },
    preview: {
      stepOneTitle: 'Nguồn dữ liệu',
      stepTwoTitle: 'Quy trình tài liệu',
    },
    error: {
      variableDuplicate: 'Tên biến đã tồn tại. Vui lòng chọn một tên khác.',
    },
    addInputField: 'Thêm trường đầu vào',
    editInputField: 'Chỉnh sửa trường nhập liệu',
    title: 'Trường đầu vào của người dùng',
    description: 'Các trường đầu vào của người dùng được sử dụng để xác định và thu thập các biến cần thiết trong quá trình thực thi quy trình. Người dùng có thể tùy chỉnh loại trường và linh hoạt cấu hình giá trị đầu vào để đáp ứng nhu cầu của các nguồn dữ liệu hoặc các bước xử lý tài liệu khác nhau.',
  },
  addDocuments: {
    steps: {
      processDocuments: 'Quy trình tài liệu',
      processingDocuments: 'Xử lý tài liệu',
      chooseDatasource: 'Chọn nguồn dữ liệu',
    },
    stepOne: {
      preview: 'Download',
    },
    stepTwo: {
      previewChunks: 'Xem trước Chunks',
      chunkSettings: 'Cài đặt Chunk',
    },
    stepThree: {
      learnMore: 'Tìm hiểu thêm',
    },
    characters: 'Ký tự',
    backToDataSource: 'Nguồn dữ liệu',
    title: 'Thêm tài liệu',
  },
  documentSettings: {
    title: 'Cài đặt tài liệu',
  },
  onlineDocument: {},
  onlineDrive: {
    breadcrumbs: {
      allFiles: 'Tất cả các tập tin',
      allBuckets: 'Tất cả các bộ lưu trữ đám mây',
      searchPlaceholder: 'Tìm kiếm tệp...',
    },
    emptySearchResult: 'Không có vật phẩm nào được tìm thấy',
    notSupportedFileType: 'Loại tệp này không được hỗ trợ',
    emptyFolder: 'Thư mục này trống',
    resetKeywords: 'Đặt lại từ khóa',
  },
  credentialSelector: {},
  conversion: {
    confirm: {
      title: 'Sự xác nhận',
      content: 'Hành động này là vĩnh viễn. Bạn sẽ không thể hoàn nguyên về phương pháp trước đó. Vui lòng xác nhận để chuyển đổi.',
    },
    title: 'Chuyển đổi sang quy trình kiến thức',
    warning: 'Hành động này không thể hoàn tác.',
    errorMessage: 'Không thể chuyển đổi tập dữ liệu thành quy trình',
    descriptionChunk2: '— một cách tiếp cận cởi mở và linh hoạt hơn với quyền truy cập vào các plugin từ thị trường của chúng tôi. Điều này sẽ áp dụng phương pháp xử lý mới cho tất cả các tài liệu trong tương lai.',
    successMessage: 'Đã chuyển đổi thành công tập dữ liệu thành một quy trình',
    descriptionChunk1: 'Giờ đây, bạn có thể chuyển đổi cơ sở kiến thức hiện có của mình để sử dụng Đường ống kiến thức để xử lý tài liệu',
  },
  knowledgePermissions: 'Quyền',
  inputField: 'Trường đầu vào',
  pipelineNameAndIcon: 'Tên đường ống & biểu tượng',
  knowledgeDescription: 'Mô tả kiến thức',
  knowledgeNameAndIcon: 'Tên kiến thức & biểu tượng',
  editPipelineInfo: 'Chỉnh sửa thông tin quy trình',
  knowledgeNameAndIconPlaceholder: 'Vui lòng nhập tên của Cơ sở kiến thức',
  knowledgeDescriptionPlaceholder: 'Mô tả những gì có trong Cơ sở kiến thức này. Mô tả chi tiết cho phép AI truy cập nội dung của tập dữ liệu chính xác hơn. Nếu trống, Dify sẽ sử dụng chiến lược hit mặc định. (Tùy chọn)',
}

export default translation
