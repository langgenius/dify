# Configuração avançada

Se precisar personalizar a configuração, consulte os comentários no nosso arquivo [.env.example](../../docker/.env.example) e atualize os valores correspondentes no seu arquivo `.env`. Além disso, talvez seja necessário fazer ajustes no próprio arquivo `docker-compose.yaml`, como alterar versões de imagem, mapeamentos de portas ou montagens de volumes, com base no seu ambiente de implantação específico e nas suas necessidades. Após fazer quaisquer alterações, execute novamente `docker-compose up -d`. Você pode encontrar a lista completa de variáveis de ambiente disponíveis [aqui](https://docs.dify.ai/getting-started/install-self-hosted/environments).

## Monitoramento de Métricas com Grafana

Importe o dashboard para o Grafana, usando o banco de dados PostgreSQL do Dify como fonte de dados, para monitorar métricas na granularidade de aplicativos, inquilinos, mensagens e muito mais.

- [Dashboard do Grafana por @bowenliang123](https://github.com/bowenliang123/dify-grafana-dashboard)

## Implantação com Kubernetes

Se deseja configurar uma instalação de alta disponibilidade, há [Helm Charts](https://helm.sh/) e arquivos YAML contribuídos pela comunidade que permitem a implantação do Dify no Kubernetes.

- [Helm Chart de @LeoQuote](https://github.com/douban/charts/tree/master/charts/dify)
- [Helm Chart de @BorisPolonsky](https://github.com/BorisPolonsky/dify-helm)
- [Helm Chart de @magicsong](https://github.com/magicsong/ai-charts)
- [Arquivo YAML por @Winson-030](https://github.com/Winson-030/dify-kubernetes)
- [Arquivo YAML por @wyy-holding](https://github.com/wyy-holding/dify-k8s)
- [🚀 NOVO! Arquivos YAML (Compatível com Dify v1.6.0) por @Zhoneym](https://github.com/Zhoneym/DifyAI-Kubernetes)

### Usando o Terraform para Implantação

Implante o Dify na Plataforma Cloud com um único clique usando [terraform](https://www.terraform.io/)

#### Azure Global

- [Azure Terraform por @nikawang](https://github.com/nikawang/dify-azure-terraform)

#### Google Cloud

- [Google Cloud Terraform por @sotazum](https://github.com/DeNA/dify-google-cloud-terraform)

### Usando AWS CDK para Implantação

Implante o Dify na AWS usando [CDK](https://aws.amazon.com/cdk/)

#### AWS

- [AWS CDK por @KevinZhao (EKS based)](https://github.com/aws-samples/solution-for-deploying-dify-on-aws)
- [AWS CDK por @tmokmss (ECS based)](https://github.com/aws-samples/dify-self-hosted-on-aws)

### Alibaba Cloud

[Alibaba Cloud Computing Nest](https://computenest.console.aliyun.com/service/instance/create/default?type=user&ServiceName=Dify%E7%A4%BE%E5%8C%BA%E7%89%88)

### Alibaba Cloud Data Management

Implante o Dify na Alibaba Cloud com um clique usando o [Alibaba Cloud Data Management](https://www.alibabacloud.com/help/en/dms/dify-in-invitational-preview/)

### Usando Azure Devops Pipeline para Implantar no AKS

Implante o Dify no AKS com um clique usando [Azure Devops Pipeline Helm Chart by @LeoZhang](https://github.com/Ruiruiz30/Dify-helm-chart-AKS)

### Implantação com Sealos

Implante o Dify com um clique usando a [Sealos App Store](https://sealos.io/products/app-store/dify/)
