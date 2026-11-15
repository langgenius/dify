# 進階設定

在 `docker/.env` 中設定本機配置。[`.env.example`](../../docker/.env.example) 僅包含預設部署所需的啟動設定，可選與服務專用設定位於 [`docker/envs/`](../../docker/envs/)。需要時，將對應範本複製為不含 `.example` 後綴的檔案；`.env` 中的值優先。修改後，在 `docker/` 目錄執行 `docker compose up -d`。詳見 [Docker 部署指南](../../docker/README.md)。

## 使用 Grafana 進行指標監控

將儀表板匯入 Grafana，使用 Dify 的 PostgreSQL 資料庫作為資料來源，以監控應用程式、租戶、訊息等顆粒度的指標。

- [由 @bowenliang123 提供的 Grafana 儀表板](https://github.com/bowenliang123/dify-grafana-dashboard)

## 使用 Kubernetes 部署

如果您想配置高可用性設置，社區貢獻的 [Helm Charts](https://helm.sh/) 和 Kubernetes 資源清單（YAML）允許在 Kubernetes 上部署 Dify。

- [由 @LeoQuote 提供的 Helm Chart](https://github.com/douban/charts/tree/master/charts/dify)
- [由 @BorisPolonsky 提供的 Helm Chart](https://github.com/BorisPolonsky/dify-helm)
- [由 @Winson-030 提供的 YAML 文件](https://github.com/Winson-030/dify-kubernetes)
- [由 @wyy-holding 提供的 YAML 文件](https://github.com/wyy-holding/dify-k8s)
- [🚀 NEW! YAML 檔案（支援 Dify v1.6.0）by @Zhoneym](https://github.com/Zhoneym/DifyAI-Kubernetes)

### 使用 Terraform 進行部署

使用 [terraform](https://www.terraform.io/) 一鍵部署 Dify 到雲端平台

#### Azure 全球

- [由 @nikawang 提供的 Azure Terraform](https://github.com/nikawang/dify-azure-terraform)

#### Google Cloud

- [由 @sotazum 提供的 Google Cloud Terraform](https://github.com/DeNA/dify-google-cloud-terraform)

### 使用 AWS CDK 進行部署

使用 [CDK](https://aws.amazon.com/cdk/) 部署 Dify 到 AWS

#### AWS

- [由 @KevinZhao 提供的 AWS CDK (EKS based)](https://github.com/aws-samples/solution-for-deploying-dify-on-aws)
- [由 @tmokmss 提供的 AWS CDK (ECS based)](https://github.com/aws-samples/dify-self-hosted-on-aws)

### 使用 阿里云计算巢進行部署

[阿里云](https://computenest.console.aliyun.com/service/instance/create/default?type=user&ServiceName=Dify%E7%A4%BE%E5%8C%BA%E7%89%88)

### 使用 阿里雲數據管理DMS 進行部署

透過 [阿里雲數據管理DMS](https://www.alibabacloud.com/help/en/dms/dify-in-invitational-preview/)，一鍵將 Dify 部署至阿里雲

### 使用 Azure Devops Pipeline 部署到AKS

使用[Azure Devops Pipeline Helm Chart by @LeoZhang](https://github.com/Ruiruiz30/Dify-helm-chart-AKS) 將 Dify 一鍵部署到 AKS

### 使用 Sealos 部署

透過 [Sealos App Store](https://sealos.io/products/app-store/dify/) 一鍵部署 Dify
