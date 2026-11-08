# 高级设置

## 自定义配置

在 `docker/.env` 中设置本地配置。[`.env.example`](../../docker/.env.example) 只包含默认部署所需的启动配置，可选和服务专用配置位于 [`docker/envs/`](../../docker/envs/)。需要时，将对应模板复制为不带 `.example` 后缀的文件；`.env` 中的值优先。修改后，在 `docker/` 目录运行 `docker compose up -d`。详见 [Docker 部署指南](../../docker/README.md)。

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
