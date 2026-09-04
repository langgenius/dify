# Advanced Setup

If you need to customize the configuration, please refer to the comments in our [.env.example](../../docker/.env.example) file and update the corresponding values in your `.env` file. Additionally, you might need to make adjustments to the `docker-compose.yaml` file itself, such as changing image versions, port mappings, or volume mounts, based on your specific deployment environment and requirements. After making any changes, please re-run `docker-compose up -d`. You can find the full list of available environment variables [here](https://docs.dify.ai/getting-started/install-self-hosted/environments).

If you'd like to configure a highly-available setup, there are community-contributed [Helm Charts](https://helm.sh/) and YAML files which allow Dify to be deployed on Kubernetes.

- [Helm Chart by @LeoQuote](https://github.com/douban/charts/tree/master/charts/dify)
- [Helm Chart by @BorisPolonsky](https://github.com/BorisPolonsky/dify-helm)
- [Helm Chart by @magicsong](https://github.com/magicsong/ai-charts)
- [YAML file by @Winson-030](https://github.com/Winson-030/dify-kubernetes)
- [YAML file by @wyy-holding](https://github.com/wyy-holding/dify-k8s)
- [🚀 NEW! YAML files (Supports Dify v1.6.0) by @Zhoneym](https://github.com/Zhoneym/DifyAI-Kubernetes)

### Terraform atorlugu pilersitsineq

wa'logh nIqHom neH ghun deployment toy'wI' [terraform](https://www.terraform.io/) lo'laH.

#### Azure Global

- [Azure Terraform mung @nikawang](https://github.com/nikawang/dify-azure-terraform)

#### Google Cloud

- [Google Cloud Terraform qachlot @sotazum](https://github.com/DeNA/dify-google-cloud-terraform)

### AWS CDK atorlugh pilersitsineq

wa'logh nIqHom neH ghun deployment toy'wI' [CDK](https://aws.amazon.com/cdk/) lo'laH.

#### AWS

- [AWS CDK qachlot @KevinZhao (EKS based)](https://github.com/aws-samples/solution-for-deploying-dify-on-aws)
- [AWS CDK qachlot @tmokmss (ECS based)](https://github.com/aws-samples/dify-self-hosted-on-aws)

### Alibaba Cloud

[Alibaba Cloud Computing Nest](https://computenest.console.aliyun.com/service/instance/create/default?type=user&ServiceName=Dify%E7%A4%BE%E5%8C%BA%E7%89%88)

### Alibaba Cloud Data Management

[Alibaba Cloud Data Management](https://www.alibabacloud.com/help/en/dms/dify-in-invitational-preview/)

### AKS 'e' Deploy je Azure Devops Pipeline lo'laH

[Azure Devops Pipeline Helm Chart by @LeoZhang](https://github.com/Ruiruiz30/Dify-helm-chart-AKS) lo'laH Dify AKS 'e' wa'DIch click 'e' Deploy

### Sealos lo'laH Deploy

[Sealos App Store](https://sealos.io/products/app-store/dify/) lo'laH Dify wa'DIch click 'e' Deploy
