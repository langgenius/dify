const translation = {
  title: 'Cài đặt Kiến thức',
  desc: 'Tại đây, bạn có thể sửa đổi các thuộc tính và phương pháp làm việc của Kiến thức.',
  form: {
    name: 'Tên Kiến thức',
    namePlaceholder: 'Vui lòng nhập tên Kiến thức',
    nameError: 'Tên không thể để trống',
    desc: 'Mô tả Kiến thức',
    descInfo: 'Vui lòng viết mô tả rõ ràng về nội dung của Kiến thức. Mô tả này sẽ được sử dụng làm cơ sở cho việc kết hợp khi lựa chọn từ nhiều Kiến thức trong quá trình suy luận.',
    descPlaceholder: 'Mô tả những gì có trong Kiến thức này. Một mô tả chi tiết giúp AI truy cập nội dung của Kiến thức một cách hiệu quả. Nếu để trống, Dify sẽ sử dụng chiến lược truy xuất mặc định.',
    descWrite: 'Tìm hiểu cách viết mô tả Kiến thức tốt.',
    permissions: 'Quyền hạn',
    permissionsOnlyMe: 'Chỉ mình tôi',
    permissionsAllMember: 'Tất cả thành viên nhóm',
    indexMethod: 'Phương pháp chỉ mục',
    indexMethodHighQuality: 'Chất lượng cao',
    indexMethodHighQualityTip: 'Sử dụng mô hình Embedding để xử lý, cung cấp độ chính xác cao hơn khi người dùng truy vấn.',
    indexMethodEconomy: 'Tiết kiệm',
    indexMethodEconomyTip: 'Sử dụng các công cụ nhúng vector ngoại tuyến, chỉ mục từ khóa, v.v. để giảm độ chính xác mà không tiêu tốn token',
    embeddingModel: 'Mô hình nhúng',
    embeddingModelTip: 'Để thay đổi mô hình nhúng, vui lòng đi tới ',
    embeddingModelTipLink: 'Cài đặt',
    retrievalSetting: {
      title: 'Cài đặt truy xuất',
      learnMore: 'Tìm hiểu thêm',
      description: ' về phương pháp truy xuất.',
      longDescription: ' về phương pháp truy xuất. Bạn có thể thay đổi điều này bất kỳ lúc nào trong cài đặt Kiến thức.',
    },
    save: 'Lưu',
  },
}

export default translation
