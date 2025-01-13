Thật tuyệt vời khi bạn muốn đóng góp cho Dify! Chúng tôi rất mong chờ được thấy những gì bạn sẽ làm. Là một startup với nguồn nhân lực và tài chính hạn chế, chúng tôi có tham vọng lớn là thiết kế quy trình trực quan nhất để xây dựng và quản lý các ứng dụng LLM. Mọi sự giúp đỡ từ cộng đồng đều rất quý giá đối với chúng tôi.

Chúng tôi cần linh hoạt và làm việc nhanh chóng, nhưng đồng thời cũng muốn đảm bảo các cộng tác viên như bạn có trải nghiệm đóng góp thuận lợi nhất có thể. Chúng tôi đã tạo ra hướng dẫn đóng góp này nhằm giúp bạn làm quen với codebase và cách chúng tôi làm việc với các cộng tác viên, để bạn có thể nhanh chóng bắt tay vào phần thú vị.

Hướng dẫn này, cũng như bản thân Dify, đang trong quá trình cải tiến liên tục. Chúng tôi rất cảm kích sự thông cảm của bạn nếu đôi khi nó không theo kịp dự án thực tế, và chúng tôi luôn hoan nghênh mọi phản hồi để cải thiện.

Về vấn đề cấp phép, xin vui lòng dành chút thời gian đọc qua [Thỏa thuận Cấp phép và Đóng góp](./LICENSE) ngắn gọn của chúng tôi. Cộng đồng cũng tuân thủ [quy tắc ứng xử](https://github.com/langgenius/.github/blob/main/CODE_OF_CONDUCT.md).

## Trước khi bắt đầu

[Tìm kiếm](https://github.com/langgenius/dify/issues?q=is:issue+is:open) một vấn đề hiện có, hoặc [tạo mới](https://github.com/langgenius/dify/issues/new/choose) một vấn đề. Chúng tôi phân loại các vấn đề thành 2 loại:

### Yêu cầu tính năng:

* Nếu bạn đang tạo một yêu cầu tính năng mới, chúng tôi muốn bạn giải thích tính năng đề xuất sẽ đạt được điều gì và cung cấp càng nhiều thông tin chi tiết càng tốt. [@perzeusss](https://github.com/perzeuss) đã tạo một [Trợ lý Yêu cầu Tính năng](https://udify.app/chat/MK2kVSnw1gakVwMX) rất hữu ích để giúp bạn soạn thảo nhu cầu của mình. Hãy thử dùng nó nhé.

* Nếu bạn muốn chọn một vấn đề từ danh sách hiện có, chỉ cần để lại bình luận dưới vấn đề đó nói rằng bạn sẽ làm.

  Một thành viên trong nhóm làm việc trong lĩnh vực liên quan sẽ được thông báo. Nếu mọi thứ ổn, họ sẽ cho phép bạn bắt đầu code. Chúng tôi yêu cầu bạn chờ đợi cho đến lúc đó trước khi bắt tay vào làm tính năng, để không lãng phí công sức của bạn nếu chúng tôi đề xuất thay đổi.

  Tùy thuộc vào lĩnh vực mà tính năng đề xuất thuộc về, bạn có thể nói chuyện với các thành viên khác nhau trong nhóm. Dưới đây là danh sách các lĩnh vực mà các thành viên trong nhóm chúng tôi đang làm việc hiện tại:

  | Thành viên                                                   | Phạm vi                                              |
  | ------------------------------------------------------------ | ---------------------------------------------------- |
  | [@yeuoly](https://github.com/Yeuoly)                         | Thiết kế kiến trúc Agents                            |
  | [@jyong](https://github.com/JohnJyong)                       | Thiết kế quy trình RAG                               |
  | [@GarfieldDai](https://github.com/GarfieldDai)               | Xây dựng quy trình làm việc                          |
  | [@iamjoel](https://github.com/iamjoel) & [@zxhlyh](https://github.com/zxhlyh) | Làm cho giao diện người dùng dễ sử dụng              |
  | [@guchenhe](https://github.com/guchenhe) & [@crazywoola](https://github.com/crazywoola) | Trải nghiệm nhà phát triển, đầu mối liên hệ cho mọi vấn đề |
  | [@takatost](https://github.com/takatost)                     | Định hướng và kiến trúc tổng thể sản phẩm            |

  Cách chúng tôi ưu tiên:

  | Loại tính năng                                               | Mức độ ưu tiên |
  | ------------------------------------------------------------ | -------------- |
  | Tính năng ưu tiên cao được gắn nhãn bởi thành viên trong nhóm | Ưu tiên cao    |
  | Yêu cầu tính năng phổ biến từ [bảng phản hồi cộng đồng](https://github.com/langgenius/dify/discussions/categories/feedbacks) của chúng tôi | Ưu tiên trung bình |
  | Tính năng không quan trọng và cải tiến nhỏ                   | Ưu tiên thấp   |
  | Có giá trị nhưng không cấp bách                              | Tính năng tương lai |

### Những vấn đề khác (ví dụ: báo cáo lỗi, tối ưu hiệu suất, sửa lỗi chính tả):

* Bắt đầu code ngay lập tức.

  Cách chúng tôi ưu tiên:

  | Loại vấn đề                                                  | Mức độ ưu tiên |
  | ------------------------------------------------------------ | -------------- |
  | Lỗi trong các chức năng chính (không thể đăng nhập, ứng dụng không hoạt động, lỗ hổng bảo mật) | Nghiêm trọng   |
  | Lỗi không quan trọng, cải thiện hiệu suất                    | Ưu tiên trung bình |
  | Sửa lỗi nhỏ (lỗi chính tả, giao diện người dùng gây nhầm lẫn nhưng vẫn hoạt động) | Ưu tiên thấp   |


## Cài đặt

Dưới đây là các bước để thiết lập Dify cho việc phát triển:

### 1. Fork repository này

### 2. Clone repository

 Clone repository đã fork từ terminal của bạn:

```
git clone git@github.com:<tên_người_dùng_github>/dify.git
```

### 3. Kiểm tra các phụ thuộc

Dify yêu cầu các phụ thuộc sau để build, hãy đảm bảo chúng đã được cài đặt trên hệ thống của bạn:

- [Docker](https://www.docker.com/)
- [Docker Compose](https://docs.docker.com/compose/install/)
- [Node.js v18.x (LTS)](http://nodejs.org)
- [npm](https://www.npmjs.com/) phiên bản 8.x.x hoặc [Yarn](https://yarnpkg.com/)
- [Python](https://www.python.org/) phiên bản 3.11.x hoặc 3.12.x

### 4. Cài đặt

Dify bao gồm một backend và một frontend. Đi đến thư mục backend bằng lệnh `cd api/`, sau đó làm theo hướng dẫn trong [README của Backend](api/README.md) để cài đặt. Trong một terminal khác, đi đến thư mục frontend bằng lệnh `cd web/`, sau đó làm theo hướng dẫn trong [README của Frontend](web/README.md) để cài đặt.

Kiểm tra [FAQ về cài đặt](https://docs.dify.ai/learn-more/faq/install-faq) để xem danh sách các vấn đề thường gặp và các bước khắc phục.

### 5. Truy cập Dify trong trình duyệt của bạn

Để xác nhận cài đặt của bạn, hãy truy cập [http://localhost:3000](http://localhost:3000) (địa chỉ mặc định, hoặc URL và cổng bạn đã cấu hình) trong trình duyệt. Bạn sẽ thấy Dify đang chạy.

## Phát triển

Nếu bạn đang thêm một nhà cung cấp mô hình, [hướng dẫn này](https://github.com/langgenius/dify/blob/main/api/core/model_runtime/README.md) dành cho bạn.

Nếu bạn đang thêm một nhà cung cấp công cụ cho Agent hoặc Workflow, [hướng dẫn này](./api/core/tools/README.md) dành cho bạn.

Để giúp bạn nhanh chóng định hướng phần đóng góp của mình, dưới đây là một bản phác thảo ngắn gọn về cấu trúc backend & frontend của Dify:

### Backend

Backend của Dify được viết bằng Python sử dụng [Flask](https://flask.palletsprojects.com/en/3.0.x/). Nó sử dụng [SQLAlchemy](https://www.sqlalchemy.org/) cho ORM và [Celery](https://docs.celeryq.dev/en/stable/getting-started/introduction.html) cho hàng đợi tác vụ. Logic xác thực được thực hiện thông qua Flask-login.

```
[api/]
├── constants             // Các cài đặt hằng số được sử dụng trong toàn bộ codebase.
├── controllers           // Định nghĩa các route API và logic xử lý yêu cầu.           
├── core                  // Điều phối ứng dụng cốt lõi, tích hợp mô hình và công cụ.
├── docker                // Cấu hình liên quan đến Docker & containerization.
├── events                // Xử lý và xử lý sự kiện
├── extensions            // Mở rộng với các framework/nền tảng bên thứ 3.
├── fields                // Định nghĩa trường cho serialization/marshalling.
├── libs                  // Thư viện và tiện ích có thể tái sử dụng.
├── migrations            // Script cho việc di chuyển cơ sở dữ liệu.
├── models                // Mô hình cơ sở dữ liệu & định nghĩa schema.
├── services              // Xác định logic nghiệp vụ.
├── storage               // Lưu trữ khóa riêng tư.      
├── tasks                 // Xử lý các tác vụ bất đồng bộ và công việc nền.
└── tests
```

### Frontend

Website được khởi tạo trên boilerplate [Next.js](https://nextjs.org/) bằng Typescript và sử dụng [Tailwind CSS](https://tailwindcss.com/) cho styling. [React-i18next](https://react.i18next.com/) được sử dụng cho việc quốc tế hóa.

```
[web/]
├── app                   // layouts, pages và components
│   ├── (commonLayout)    // layout chung được sử dụng trong toàn bộ ứng dụng
│   ├── (shareLayout)     // layouts được chia sẻ cụ thể cho các phiên dựa trên token 
│   ├── activate          // trang kích hoạt
│   ├── components        // được chia sẻ bởi các trang và layouts
│   ├── install           // trang cài đặt
│   ├── signin            // trang đăng nhập
│   └── styles            // styles được chia sẻ toàn cục
├── assets                // Tài nguyên tĩnh
├── bin                   // scripts chạy ở bước build
├── config                // cài đặt và tùy chọn có thể điều chỉnh 
├── context               // contexts được chia sẻ bởi các phần khác nhau của ứng dụng
├── dictionaries          // File dịch cho từng ngôn ngữ 
├── docker                // cấu hình container
├── hooks                 // Hooks có thể tái sử dụng
├── i18n                  // Cấu hình quốc tế hóa
├── models                // mô tả các mô hình dữ liệu & hình dạng của phản hồi API
├── public                // tài nguyên meta như favicon
├── service               // xác định hình dạng của các hành động API
├── test                  
├── types                 // mô tả các tham số hàm và giá trị trả về
└── utils                 // Các hàm tiện ích được chia sẻ
```

## Gửi PR của bạn

Cuối cùng, đã đến lúc mở một pull request (PR) đến repository của chúng tôi. Đối với các tính năng lớn, chúng tôi sẽ merge chúng vào nhánh `deploy/dev` để kiểm tra trước khi đưa vào nhánh `main`. Nếu bạn gặp vấn đề như xung đột merge hoặc không biết cách mở pull request, hãy xem [hướng dẫn về pull request của GitHub](https://docs.github.com/en/pull-requests/collaborating-with-pull-requests).

Và thế là xong! Khi PR của bạn được merge, bạn sẽ được giới thiệu là một người đóng góp trong [README](https://github.com/langgenius/dify/blob/main/README.md) của chúng tôi.

## Nhận trợ giúp

Nếu bạn gặp khó khăn hoặc có câu hỏi cấp bách trong quá trình đóng góp, hãy đặt câu hỏi của bạn trong vấn đề GitHub liên quan, hoặc tham gia [Discord](https://discord.gg/8Tpq4AcN9c) của chúng tôi để trò chuyện nhanh chóng.
