# Gelişmiş Kurulum

Yapılandırmayı özelleştirmeniz gerekiyorsa, lütfen [.env.example](../../docker/.env.example) dosyamızdaki yorumlara bakın ve `.env` dosyanızdaki ilgili değerleri güncelleyin. Ayrıca, spesifik dağıtım ortamınıza ve gereksinimlerinize bağlı olarak `docker-compose.yaml` dosyasının kendisinde de, imaj sürümlerini, port eşlemelerini veya hacim bağlantılarını değiştirmek gibi ayarlamalar yapmanız gerekebilir. Herhangi bir değişiklik yaptıktan sonra, lütfen `docker-compose up -d` komutunu tekrar çalıştırın. Kullanılabilir tüm ortam değişkenlerinin tam listesini [burada](https://docs.dify.ai/getting-started/install-self-hosted/environments) bulabilirsiniz.

## Grafana ile Metrik İzleme

Uygulamalar, kiracılar, mesajlar ve daha fazlasının granularitesinde metrikleri izlemek için Dify'nin PostgreSQL veritabanını veri kaynağı olarak kullanarak panoyu Grafana'ya aktarın.

- [@bowenliang123 tarafından Grafana Panosu](https://github.com/bowenliang123/dify-grafana-dashboard)

## Kubernetes ile Dağıtım

Yüksek kullanılabilirliğe sahip bir kurulum yapılandırmak isterseniz, Dify'ın Kubernetes üzerine dağıtılmasına olanak tanıyan topluluk katkılı [Helm Charts](https://helm.sh/) ve YAML dosyaları mevcuttur.

- [@LeoQuote tarafından Helm Chart](https://github.com/douban/charts/tree/master/charts/dify)
- [@BorisPolonsky tarafından Helm Chart](https://github.com/BorisPolonsky/dify-helm)
- [@Winson-030 tarafından YAML dosyası](https://github.com/Winson-030/dify-kubernetes)
- [@wyy-holding tarafından YAML dosyası](https://github.com/wyy-holding/dify-k8s)
- [🚀 YENİ! YAML dosyaları (Dify v1.6.0 destekli) @Zhoneym tarafından](https://github.com/Zhoneym/DifyAI-Kubernetes)

### Dağıtım için Terraform Kullanımı

Dify'ı bulut platformuna tek tıklamayla dağıtın [terraform](https://www.terraform.io/) kullanarak

#### Azure Global

- [Azure Terraform tarafından @nikawang](https://github.com/nikawang/dify-azure-terraform)

#### Google Cloud

- [Google Cloud Terraform tarafından @sotazum](https://github.com/DeNA/dify-google-cloud-terraform)

### AWS CDK ile Dağıtım

[CDK](https://aws.amazon.com/cdk/) kullanarak Dify'ı AWS'ye dağıtın

#### AWS

- [AWS CDK tarafından @KevinZhao (EKS based)](https://github.com/aws-samples/solution-for-deploying-dify-on-aws)
- [AWS CDK tarafından @tmokmss (ECS based)](https://github.com/aws-samples/dify-self-hosted-on-aws)

### Alibaba Cloud

[Alibaba Cloud Computing Nest](https://computenest.console.aliyun.com/service/instance/create/default?type=user&ServiceName=Dify%E7%A4%BE%E5%8C%BA%E7%89%88)

### Alibaba Cloud Data Management

[Alibaba Cloud Data Management](https://www.alibabacloud.com/help/en/dms/dify-in-invitational-preview/) kullanarak Dify'ı tek tıkla Alibaba Cloud'a dağıtın

### AKS'ye Dağıtım için Azure Devops Pipeline Kullanımı

[Azure Devops Pipeline Helm Chart by @LeoZhang](https://github.com/Ruiruiz30/Dify-helm-chart-AKS) kullanarak Dify'ı tek tıkla AKS'ye dağıtın

### Sealos ile Dağıtım

[Sealos App Store](https://sealos.io/products/app-store/dify/) kullanarak Dify'ı tek tıkla dağıtın
