# Thiết lập nâng cao

Nếu bạn cần tùy chỉnh cấu hình, vui lòng tham khảo các nhận xét trong tệp [.env.example](../../docker/.env.example) của chúng tôi và cập nhật các giá trị tương ứng trong tệp `.env` của bạn. Ngoài ra, bạn có thể cần điều chỉnh tệp `docker-compose.yaml`, chẳng hạn như thay đổi phiên bản hình ảnh, ánh xạ cổng hoặc gắn kết khối lượng, dựa trên môi trường triển khai cụ thể và yêu cầu của bạn. Sau khi thực hiện bất kỳ thay đổi nào, vui lòng chạy lại `docker-compose up -d`. Bạn có thể tìm thấy danh sách đầy đủ các biến môi trường có sẵn [tại đây](https://docs.dify.ai/getting-started/install-self-hosted/environments).

## Giám sát Số liệu với Grafana

Nhập bảng điều khiển vào Grafana, sử dụng cơ sở dữ liệu PostgreSQL của Dify làm nguồn dữ liệu, để giám sát số liệu theo mức độ chi tiết của ứng dụng, người thuê, tin nhắn và hơn thế nữa.

- [Bảng điều khiển Grafana của @bowenliang123](https://github.com/bowenliang123/dify-grafana-dashboard)

## Triển khai với Kubernetes

Nếu bạn muốn cấu hình một cài đặt có độ sẵn sàng cao, có các [Helm Charts](https://helm.sh/) và tệp YAML do cộng đồng đóng góp cho phép Dify được triển khai trên Kubernetes.

- [Helm Chart bởi @LeoQuote](https://github.com/douban/charts/tree/master/charts/dify)
- [Helm Chart bởi @BorisPolonsky](https://github.com/BorisPolonsky/dify-helm)
- [Tệp YAML bởi @Winson-030](https://github.com/Winson-030/dify-kubernetes)
- [Tệp YAML bởi @wyy-holding](https://github.com/wyy-holding/dify-k8s)
- [🚀 MỚI! Tệp YAML (Hỗ trợ Dify v1.6.0) bởi @Zhoneym](https://github.com/Zhoneym/DifyAI-Kubernetes)

### Sử dụng Terraform để Triển khai

Triển khai Dify lên nền tảng đám mây với một cú nhấp chuột bằng cách sử dụng [terraform](https://www.terraform.io/)

#### Azure Global

- [Azure Terraform bởi @nikawang](https://github.com/nikawang/dify-azure-terraform)

#### Google Cloud

- [Google Cloud Terraform bởi @sotazum](https://github.com/DeNA/dify-google-cloud-terraform)

### Sử dụng AWS CDK để Triển khai

Triển khai Dify trên AWS bằng [CDK](https://aws.amazon.com/cdk/)

#### AWS

- [AWS CDK bởi @KevinZhao (EKS based)](https://github.com/aws-samples/solution-for-deploying-dify-on-aws)
- [AWS CDK bởi @tmokmss (ECS based)](https://github.com/aws-samples/dify-self-hosted-on-aws)

### Alibaba Cloud

[Alibaba Cloud Computing Nest](https://computenest.console.aliyun.com/service/instance/create/default?type=user&ServiceName=Dify%E7%A4%BE%E5%8C%BA%E7%89%88)

### Alibaba Cloud Data Management

Triển khai Dify lên Alibaba Cloud chỉ với một cú nhấp chuột bằng [Alibaba Cloud Data Management](https://www.alibabacloud.com/help/en/dms/dify-in-invitational-preview/)

### Sử dụng Azure Devops Pipeline để Triển khai lên AKS

Triển khai Dify lên AKS chỉ với một cú nhấp chuột bằng [Azure Devops Pipeline Helm Chart bởi @LeoZhang](https://github.com/Ruiruiz30/Dify-helm-chart-AKS)

### Triển khai với Sealos

Triển khai Dify chỉ với một cú nhấp chuột từ [Sealos App Store](https://sealos.io/products/app-store/dify/)
