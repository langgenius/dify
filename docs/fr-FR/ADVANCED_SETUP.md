# Configuration avancée

Configurez votre installation dans `docker/.env`. [`.env.example`](../../docker/.env.example) contient les paramètres nécessaires au déploiement par défaut ; les options avancées et propres aux services sont dans [`docker/envs/`](../../docker/envs/). Copiez les modèles nécessaires sans le suffixe `.example`. Les valeurs de `.env` sont prioritaires. Après modification, exécutez `docker compose up -d` depuis `docker/`. Consultez le [guide Docker](../../docker/README.md).

## Surveillance des Métriques avec Grafana

Importez le tableau de bord dans Grafana, en utilisant la base de données PostgreSQL de Dify comme source de données, pour surveiller les métriques avec une granularité d'applications, de locataires, de messages et plus.

- [Tableau de bord Grafana par @bowenliang123](https://github.com/bowenliang123/dify-grafana-dashboard)

## Déploiement avec Kubernetes

Si vous souhaitez configurer une configuration haute disponibilité, la communauté fournit des [Helm Charts](https://helm.sh/) et des fichiers YAML, à travers lesquels vous pouvez déployer Dify sur Kubernetes.

- [Helm Chart par @LeoQuote](https://github.com/douban/charts/tree/master/charts/dify)
- [Helm Chart par @BorisPolonsky](https://github.com/BorisPolonsky/dify-helm)
- [Helm Chart par @magicsong](https://github.com/magicsong/ai-charts)
- [Fichier YAML par @Winson-030](https://github.com/Winson-030/dify-kubernetes)
- [Fichier YAML par @wyy-holding](https://github.com/wyy-holding/dify-k8s)
- [🚀 NOUVEAU ! Fichiers YAML (compatible avec Dify v1.6.0) par @Zhoneym](https://github.com/Zhoneym/DifyAI-Kubernetes)

### Utilisation de Terraform pour le déploiement

Déployez Dify sur une plateforme cloud en un clic en utilisant [terraform](https://www.terraform.io/)

#### Azure Global

- [Azure Terraform par @nikawang](https://github.com/nikawang/dify-azure-terraform)

#### Google Cloud

- [Google Cloud Terraform par @sotazum](https://github.com/DeNA/dify-google-cloud-terraform)

### Utilisation d'AWS CDK pour le déploiement

Déployez Dify sur AWS en utilisant [CDK](https://aws.amazon.com/cdk/)

#### AWS

- [AWS CDK par @KevinZhao (EKS based)](https://github.com/aws-samples/solution-for-deploying-dify-on-aws)
- [AWS CDK par @tmokmss (ECS based)](https://github.com/aws-samples/dify-self-hosted-on-aws)

### Alibaba Cloud

[Alibaba Cloud Computing Nest](https://computenest.console.aliyun.com/service/instance/create/default?type=user&ServiceName=Dify%E7%A4%BE%E5%8C%BA%E7%89%88)

### Alibaba Cloud Data Management

Déployez Dify en un clic sur Alibaba Cloud avec [Alibaba Cloud Data Management](https://www.alibabacloud.com/help/en/dms/dify-in-invitational-preview/)

### Utilisation d'Azure Devops Pipeline pour déployer sur AKS

Déployez Dify sur AKS en un clic en utilisant [Azure Devops Pipeline Helm Chart by @LeoZhang](https://github.com/Ruiruiz30/Dify-helm-chart-AKS)

### Déploiement avec Sealos

Déployez Dify en un clic depuis le [Sealos App Store](https://sealos.io/products/app-store/dify/)
