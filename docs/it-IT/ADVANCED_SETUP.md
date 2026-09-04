# Configurazioni Avanzate

Se dovete personalizzare la configurazione, leggete i commenti nel nostro file [.env.example](../../docker/.env.example) e aggiornate i valori corrispondenti nel vostro file `.env`. Inoltre, potrebbe essere necessario apportare modifiche al file `docker-compose.yaml`, come cambiare le versioni delle immagini, le mappature delle porte o i mount dei volumi, a seconda del vostro ambiente di distribuzione specifico e dei vostri requisiti. Dopo aver apportato le modifiche, riavviate `docker-compose up -d`. L'elenco completo delle variabili d'ambiente disponibili è disponibile [qui](https://docs.dify.ai/getting-started/install-self-hosted/environments).

## Monitoraggio delle Metriche con Grafana

Importate la dashboard in Grafana, utilizzando il database PostgreSQL di Dify come origine dati, per monitorare le metriche a livello di app, tenant, messaggi e altro ancora.

- [Dashboard Grafana di @bowenliang123](https://github.com/bowenliang123/dify-grafana-dashboard)

## Distribuzione con Kubernetes

Se desiderate configurare un'installazione ad alta disponibilità, ci sono [Helm Charts](https://helm.sh/) e file YAML forniti dalla community che consentono di distribuire Dify su Kubernetes.

- [Helm Chart di @LeoQuote](https://github.com/douban/charts/tree/master/charts/dify)
- [Helm Chart di @BorisPolonsky](https://github.com/BorisPolonsky/dify-helm)
- [Helm Chart di @magicsong](https://github.com/magicsong/ai-charts)
- [File YAML di @Winson-030](https://github.com/Winson-030/dify-kubernetes)
- [File YAML di @wyy-holding](https://github.com/wyy-holding/dify-k8s)
- [🚀 NUOVO! File YAML (Supporta Dify v1.6.0) di @Zhoneym](https://github.com/Zhoneym/DifyAI-Kubernetes)

### Utilizzo di Terraform per la Distribuzione

Distribuite Dify con un solo clic su una piattaforma cloud utilizzando [terraform](https://www.terraform.io/).

#### Azure Global

- [Azure Terraform di @nikawang](https://github.com/nikawang/dify-azure-terraform)

#### Google Cloud

- [Google Cloud Terraform di @sotazum](https://github.com/DeNA/dify-google-cloud-terraform)

### Utilizzo di AWS CDK per la Distribuzione

Distribuzione di Dify su AWS con [CDK](https://aws.amazon.com/cdk/)

#### AWS

- [AWS CDK di @KevinZhao (basato su EKS)](https://github.com/aws-samples/solution-for-deploying-dify-on-aws)
- [AWS CDK di @tmokmss (basato su ECS)](https://github.com/aws-samples/dify-self-hosted-on-aws)

### Alibaba Cloud

[Alibaba Cloud Computing Nest](https://computenest.console.aliyun.com/service/instance/create/default?type=user&ServiceName=Dify%E7%A4%BE%E5%8C%BA%E7%89%88)

### Alibaba Cloud Data Management

Distribuzione con un clic di Dify su Alibaba Cloud con [Alibaba Cloud Data Management](https://www.alibabacloud.com/help/en/dms/dify-in-invitational-preview/)

### Utilizzo di Azure DevOps Pipeline per la Distribuzione su AKS

Distribuite Dify con un clic in AKS utilizzando [Azure DevOps Pipeline Helm Chart di @LeoZhang](https://github.com/Ruiruiz30/Dify-helm-chart-AKS)

### Distribuzione con Sealos

Distribuite Dify con un clic tramite [Sealos App Store](https://sealos.io/products/app-store/dify/)
