# 高级设置

## 自定义配置

如果您需要自定义配置，请参考 [.env.example](../../docker/.env.example) 文件中的注释，并更新 `.env` 文件中对应的值。此外，您可能需要根据您的具体部署环境和需求对 `docker-compose.yaml` 文件本身进行调整，例如更改镜像版本、端口映射或卷挂载。完成任何更改后，请重新运行 `docker-compose up -d`。您可以在[此处](https://docs.dify.ai/getting-started/install-self-hosted/environments)找到可用环境变量的完整列表。

## 使用 Grafana 进行指标监控

将仪表板导入 Grafana，使用 Dify 的 PostgreSQL 数据库作为数据源，以监控应用、租户、消息等粒度的指标。

- [由 @bowenliang123 提供的 Grafana 仪表板](https://github.com/bowenliang123/dify-grafana-dashboard)

## 使用 Helm Chart 或 Kubernetes 资源清单（YAML）部署

使用 [Helm Chart](https://helm.sh/) 版本或者 Kubernetes 资源清单（YAML），可以在 Kubernetes 上部署 Dify。

- [Helm Chart by @LeoQuote](https://github.com/douban/charts/tree/master/charts/dify)

- [Helm Chart by @BorisPolonsky](https://github.com/BorisPolonsky/dify-helm)

- [Helm Chart by @magicsong](https://github.com/magicsong/ai-charts)

- [YAML 文件 by @Winson-030](https://github.com/Winson-030/dify-kubernetes)

- [YAML file by @wyy-holding](https://github.com/wyy-holding/dify-k8s)

- [🚀 NEW! YAML 文件 (支持 Dify v1.6.0) by @Zhoneym](https://github.com/Zhoneym/DifyAI-Kubernetes)

### 使用 Terraform 部署

使用 [terraform](https://www.terraform.io/) 一键将 Dify 部署到云平台

#### Azure Global

- [Azure Terraform by @nikawang](https://github.com/nikawang/dify-azure-terraform)

#### Google Cloud

- [Google Cloud Terraform by @sotazum](https://github.com/DeNA/dify-google-cloud-terraform)

### 使用 AWS CDK 部署

使用 [CDK](https://aws.amazon.com/cdk/) 将 Dify 部署到 AWS

#### AWS

- [AWS CDK by @KevinZhao (EKS based)](https://github.com/aws-samples/solution-for-deploying-dify-on-aws)
- [AWS CDK by @tmokmss (ECS based)](https://github.com/aws-samples/dify-self-hosted-on-aws)

### 使用 阿里云计算巢 部署

使用 [阿里云计算巢](https://computenest.console.aliyun.com/service/instance/create/default?type=user&ServiceName=Dify%E7%A4%BE%E5%8C%BA%E7%89%88) 将 Dify 一键部署到 阿里云

### 使用 阿里云数据管理DMS 部署

使用 [阿里云数据管理DMS](https://help.aliyun.com/zh/dms/dify-in-invitational-preview) 将 Dify 一键部署到 阿里云

### 使用 Azure Devops Pipeline 部署到AKS

使用[Azure Devops Pipeline Helm Chart by @LeoZhang](https://github.com/Ruiruiz30/Dify-helm-chart-AKS) 将 Dify 一键部署到 AKS

### 使用 Sealos 部署

通过 [Sealos App Store](https://sealos.io/products/app-store/dify/) 一键部署 Dify
