# Erweiterte Einstellungen

Falls Sie die Konfiguration anpassen müssen, lesen Sie bitte die Kommentare in unserer [.env.example](../../docker/.env.example)-Datei und aktualisieren Sie die entsprechenden Werte in Ihrer `.env`-Datei. Zusätzlich müssen Sie eventuell Anpassungen an der `docker-compose.yaml`-Datei vornehmen, wie zum Beispiel das Ändern von Image-Versionen, Portzuordnungen oder Volumen-Mounts, je nach Ihrer spezifischen Einsatzumgebung und Ihren Anforderungen. Nachdem Sie Änderungen vorgenommen haben, starten Sie `docker-compose up -d` erneut. Eine vollständige Liste der verfügbaren Umgebungsvariablen finden Sie [hier](https://docs.dify.ai/getting-started/install-self-hosted/environments).

## Metriküberwachung mit Grafana

Importieren Sie das Dashboard in Grafana, wobei Sie die PostgreSQL-Datenbank von Dify als Datenquelle verwenden, um Metriken in der Granularität von Apps, Mandanten, Nachrichten und mehr zu überwachen.

- [Grafana-Dashboard von @bowenliang123](https://github.com/bowenliang123/dify-grafana-dashboard)

## Bereitstellung mit Kubernetes

Falls Sie eine hochverfügbare Konfiguration einrichten möchten, gibt es von der Community bereitgestellte [Helm Charts](https://helm.sh/) und YAML-Dateien, die es ermöglichen, Dify auf Kubernetes bereitzustellen.

- [Helm Chart by @LeoQuote](https://github.com/douban/charts/tree/master/charts/dify)
- [Helm Chart by @BorisPolonsky](https://github.com/BorisPolonsky/dify-helm)
- [Helm Chart by @magicsong](https://github.com/magicsong/ai-charts)
- [YAML file by @Winson-030](https://github.com/Winson-030/dify-kubernetes)
- [YAML file by @wyy-holding](https://github.com/wyy-holding/dify-k8s)
- [🚀 NEW! YAML files (Supports Dify v1.6.0) by @Zhoneym](https://github.com/Zhoneym/DifyAI-Kubernetes)

### Terraform für die Bereitstellung verwenden

Stellen Sie Dify mit nur einem Klick mithilfe von [terraform](https://www.terraform.io/) auf einer Cloud-Plattform bereit.

#### Azure Global

- [Azure Terraform by @nikawang](https://github.com/nikawang/dify-azure-terraform)

#### Google Cloud

- [Google Cloud Terraform by @sotazum](https://github.com/DeNA/dify-google-cloud-terraform)

### Verwendung von AWS CDK für die Bereitstellung

Bereitstellung von Dify auf AWS mit [CDK](https://aws.amazon.com/cdk/)

#### AWS

- [AWS CDK by @KevinZhao (EKS based)](https://github.com/aws-samples/solution-for-deploying-dify-on-aws)
- [AWS CDK by @tmokmss (ECS based)](https://github.com/aws-samples/dify-self-hosted-on-aws)

### Alibaba Cloud

[Alibaba Cloud Computing Nest](https://computenest.console.aliyun.com/service/instance/create/default?type=user&ServiceName=Dify%E7%A4%BE%E5%8C%BA%E7%89%88)

### Alibaba Cloud Data Management

Ein-Klick-Bereitstellung von Dify in der Alibaba Cloud mit [Alibaba Cloud Data Management](https://www.alibabacloud.com/help/en/dms/dify-in-invitational-preview/)

### Verwendung von Azure Devops Pipeline für AKS-Bereitstellung

Stellen Sie Dify mit einem Klick in AKS bereit, indem Sie [Azure Devops Pipeline Helm Chart by @LeoZhang](https://github.com/Ruiruiz30/Dify-helm-chart-AKS) verwenden

### Bereitstellung mit Sealos

Stellen Sie Dify mit einem Klick über den [Sealos App Store](https://sealos.io/products/app-store/dify/) bereit
