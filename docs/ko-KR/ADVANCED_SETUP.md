# 고급 설정

로컬 설정은 `docker/.env`에서 변경하세요. [`.env.example`](../../docker/.env.example)에는 기본 배포에 필요한 설정만 있으며, 선택 사항과 서비스별 설정은 [`docker/envs/`](../../docker/envs/)에 있습니다. 필요한 템플릿을 `.example` 접미사 없이 복사하세요. `.env`의 값이 우선합니다. 변경 후 `docker/`에서 `docker compose up -d`를 실행하세요. 자세한 내용은 [Docker 가이드](../../docker/README.md)를 참고하세요.

## Grafana를 사용한 메트릭 모니터링

Dify의 PostgreSQL 데이터베이스를 데이터 소스로 사용하여 앱, 테넌트, 메시지 등에 대한 세분화된 메트릭을 모니터링하기 위해 대시보드를 Grafana로 가져옵니다.

- [@bowenliang123의 Grafana 대시보드](https://github.com/bowenliang123/dify-grafana-dashboard)

## Kubernetes를 통한 배포

Dify를 Kubernetes에 배포하고 프리미엄 스케일링 설정을 구성했다는 커뮤니티가 제공하는 [Helm Charts](https://helm.sh/)와 YAML 파일이 존재합니다.

- [Helm Chart by @LeoQuote](https://github.com/douban/charts/tree/master/charts/dify)
- [Helm Chart by @BorisPolonsky](https://github.com/BorisPolonsky/dify-helm)
- [Helm Chart by @magicsong](https://github.com/magicsong/ai-charts)
- [YAML file by @Winson-030](https://github.com/Winson-030/dify-kubernetes)
- [YAML file by @wyy-holding](https://github.com/wyy-holding/dify-k8s)
- [🚀 NEW! YAML files (Supports Dify v1.6.0) by @Zhoneym](https://github.com/Zhoneym/DifyAI-Kubernetes)

### Terraform을 사용한 배포

[terraform](https://www.terraform.io/)을 사용하여 단 한 번의 클릭으로 Dify를 클라우드 플랫폼에 배포하십시오

#### Azure Global

- [nikawang의 Azure Terraform](https://github.com/nikawang/dify-azure-terraform)

#### Google Cloud

- [sotazum의 Google Cloud Terraform](https://github.com/DeNA/dify-google-cloud-terraform)

### AWS CDK를 사용한 배포

[CDK](https://aws.amazon.com/cdk/)를 사용하여 AWS에 Dify 배포

#### AWS

- [KevinZhao의 AWS CDK (EKS based)](https://github.com/aws-samples/solution-for-deploying-dify-on-aws)
- [tmokmss의 AWS CDK (ECS based)](https://github.com/aws-samples/dify-self-hosted-on-aws)

### Alibaba Cloud

[Alibaba Cloud Computing Nest](https://computenest.console.aliyun.com/service/instance/create/default?type=user&ServiceName=Dify%E7%A4%BE%E5%8C%BA%E7%89%88)

### Alibaba Cloud Data Management

[Alibaba Cloud Data Management](https://www.alibabacloud.com/help/en/dms/dify-in-invitational-preview/)를 통해 원클릭으로 Dify를 Alibaba Cloud에 배포할 수 있습니다

### AKS에 배포하기 위해 Azure Devops Pipeline 사용

[Azure Devops Pipeline Helm Chart by @LeoZhang](https://github.com/Ruiruiz30/Dify-helm-chart-AKS)을 사용하여 Dify를 AKS에 원클릭으로 배포

### Sealos를 사용한 배포

[Sealos App Store](https://sealos.io/products/app-store/dify/)를 사용하여 Dify를 원클릭으로 배포할 수 있습니다
