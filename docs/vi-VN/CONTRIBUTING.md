# ĐÓNG GÓP

Bạn đang muốn đóng góp cho Dify - thật tuyệt vời, chúng tôi rất mong được thấy những gì bạn sẽ làm. Là một startup với nguồn nhân lực và tài chính hạn chế, chúng tôi có tham vọng lớn trong việc thiết kế quy trình trực quan nhất để xây dựng và quản lý các ứng dụng LLM. Mọi sự giúp đỡ từ cộng đồng đều rất có ý nghĩa.

Chúng tôi cần phải nhanh nhẹn và triển khai nhanh chóng, nhưng cũng muốn đảm bảo những người đóng góp như bạn có trải nghiệm đóng góp thuận lợi nhất có thể. Chúng tôi đã tạo hướng dẫn đóng góp này nhằm giúp bạn làm quen với codebase và cách chúng tôi làm việc với người đóng góp, để bạn có thể nhanh chóng bắt đầu phần thú vị.

Hướng dẫn này, giống như Dify, đang được phát triển liên tục. Chúng tôi rất cảm kích sự thông cảm của bạn nếu đôi khi nó chưa theo kịp dự án thực tế, và hoan nghênh mọi phản hồi để cải thiện.

Về giấy phép, vui lòng dành chút thời gian đọc [Thỏa thuận Cấp phép và Người đóng góp](../../LICENSE) ngắn gọn của chúng tôi. Cộng đồng cũng tuân theo [quy tắc ứng xử](https://github.com/langgenius/.github/blob/main/CODE_OF_CONDUCT.md).

## Trước khi bắt đầu

Đang tìm việc để thực hiện? Hãy xem qua [các issue dành cho người mới](https://github.com/langgenius/dify/issues?q=is%3Aissue%20state%3Aopen%20label%3A%22good%20first%20issue%22) và chọn một để bắt đầu!

Bạn có một model runtime hoặc công cụ mới thú vị để thêm vào? Mở PR trong [repo plugin](https://github.com/langgenius/dify-plugins) của chúng tôi và cho chúng tôi thấy những gì bạn đã xây dựng.

Cần cập nhật model runtime, công cụ hiện có hoặc sửa lỗi? Ghé thăm [repo plugin chính thức](https://github.com/langgenius/dify-official-plugins) và thực hiện phép màu của bạn!

Hãy tham gia, đóng góp và cùng nhau xây dựng điều tuyệt vời! 💡✨

Đừng quên liên kết đến issue hiện có hoặc mở issue mới trong mô tả PR.

### Báo cáo lỗi

> [!QUAN TRỌNG]\
> Vui lòng đảm bảo cung cấp các thông tin sau khi gửi báo cáo lỗi:

- Tiêu đề rõ ràng và mô tả
- Mô tả chi tiết về lỗi, bao gồm các thông báo lỗi
- Các bước để tái hiện lỗi
- Hành vi mong đợi
- **Log**, nếu có, cho các vấn đề backend, điều này rất quan trọng, bạn có thể tìm thấy chúng trong docker-compose logs
- Ảnh chụp màn hình hoặc video, nếu có thể

Cách chúng tôi ưu tiên:

| Loại vấn đề | Mức độ ưu tiên |
| ----------- | -------------- |
| Lỗi trong các chức năng cốt lõi (dịch vụ đám mây, không thể đăng nhập, ứng dụng không hoạt động, lỗ hổng bảo mật) | Quan trọng |
| Lỗi không nghiêm trọng, cải thiện hiệu suất | Ưu tiên trung bình |
| Sửa lỗi nhỏ (lỗi chính tả, UI gây nhầm lẫn nhưng vẫn hoạt động) | Ưu tiên thấp |

### Yêu cầu tính năng

> [!LƯU Ý]
> Vui lòng đảm bảo cung cấp các thông tin sau khi gửi yêu cầu tính năng:

- Tiêu đề rõ ràng và mô tả
- Mô tả chi tiết về tính năng
- Trường hợp sử dụng cho tính năng
- Bất kỳ ngữ cảnh hoặc ảnh chụp màn hình nào về yêu cầu tính năng

Cách chúng tôi ưu tiên:

| Loại tính năng | Mức độ ưu tiên |
| -------------- | -------------- |
| Tính năng ưu tiên cao được gắn nhãn bởi thành viên nhóm | Ưu tiên cao |
| Yêu cầu tính năng phổ biến từ [bảng phản hồi cộng đồng](https://github.com/langgenius/dify/discussions/categories/feedbacks) | Ưu tiên trung bình |
| Tính năng không cốt lõi và cải tiến nhỏ | Ưu tiên thấp |
| Có giá trị nhưng không cấp bách | Tính năng tương lai |

## Gửi PR của bạn

### Quy trình tạo Pull Request

1. Fork repository
1. Trước khi soạn PR, vui lòng tạo issue để thảo luận về các thay đổi bạn muốn thực hiện
1. Tạo nhánh mới cho các thay đổi của bạn
1. Vui lòng thêm test cho các thay đổi tương ứng
1. Đảm bảo code của bạn vượt qua các test hiện có
1. Vui lòng liên kết issue trong mô tả PR, `fixes #<số_issue>`
1. Được merge!

### Thiết lập dự án

#### Frontend

Để thiết lập dịch vụ frontend, vui lòng tham khảo [hướng dẫn](https://github.com/langgenius/dify/blob/main/web/README.md) chi tiết của chúng tôi trong file `web/README.md`. Tài liệu này cung cấp hướng dẫn chi tiết để giúp bạn thiết lập môi trường frontend một cách đúng đắn.

#### Backend

Để thiết lập dịch vụ backend, vui lòng tham khảo [hướng dẫn](https://github.com/langgenius/dify/blob/main/api/README.md) chi tiết của chúng tôi trong file `api/README.md`. Tài liệu này chứa hướng dẫn từng bước để giúp bạn khởi chạy backend một cách suôn sẻ.

#### Các điểm cần lưu ý khác

Chúng tôi khuyến nghị xem xét kỹ tài liệu này trước khi tiến hành thiết lập, vì nó chứa thông tin thiết yếu về:

- Điều kiện tiên quyết và dependencies
- Các bước cài đặt
- Chi tiết cấu hình
- Các mẹo xử lý sự cố phổ biến

Đừng ngần ngại liên hệ nếu bạn gặp bất kỳ vấn đề nào trong quá trình thiết lập.

## Nhận trợ giúp

Nếu bạn bị mắc kẹt hoặc có câu hỏi cấp bách trong quá trình đóng góp, chỉ cần gửi câu hỏi của bạn thông qua issue GitHub liên quan, hoặc tham gia [Discord](https://discord.gg/8Tpq4AcN9c) của chúng tôi để trò chuyện nhanh.
