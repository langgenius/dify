# Napredne nastavitve

Če morate prilagoditi konfiguracijo, si oglejte komentarje v naši datoteki .env.example in posodobite ustrezne vrednosti v svoji .env datoteki. Poleg tega boste morda morali prilagoditi docker-compose.yamlsamo datoteko, na primer spremeniti različice slike, preslikave vrat ali namestitve nosilca, glede na vaše specifično okolje in zahteve za uvajanje. Po kakršnih koli spremembah ponovno zaženite docker-compose up -d. Celoten seznam razpoložljivih spremenljivk okolja najdete tukaj .

## Spremljanje metrik z Grafana

Uvoz nadzorne plošče v Grafana, z uporabo Difyjeve PostgreSQL baze podatkov kot vir podatkov, za spremljanje metrike glede na podrobnost aplikacij, najemnikov, sporočil in drugega.

- [Nadzorna plošča Grafana avtorja @bowenliang123](https://github.com/bowenliang123/dify-grafana-dashboard)

## Namestitev s Kubernetes

Če želite konfigurirati visoko razpoložljivo nastavitev, so na voljo Helm Charts in datoteke YAML, ki jih prispeva skupnost, ki omogočajo uvedbo Difyja v Kubernetes.

- [Helm Chart by @LeoQuote](https://github.com/douban/charts/tree/master/charts/dify)
- [Helm Chart by @BorisPolonsky](https://github.com/BorisPolonsky/dify-helm)
- [YAML file by @Winson-030](https://github.com/Winson-030/dify-kubernetes)
- [YAML file by @wyy-holding](https://github.com/wyy-holding/dify-k8s)
- [🚀 NEW! YAML files (Supports Dify v1.6.0) by @Zhoneym](https://github.com/Zhoneym/DifyAI-Kubernetes)

### Uporaba Terraform za uvajanje

namestite Dify v Cloud Platform z enim klikom z uporabo [terraform](https://www.terraform.io/)

#### Azure Global

- [Azure Terraform by @nikawang](https://github.com/nikawang/dify-azure-terraform)

#### Google Cloud

- [Google Cloud Terraform by @sotazum](https://github.com/DeNA/dify-google-cloud-terraform)

### Uporaba AWS CDK za uvajanje

Uvedite Dify v AWS z uporabo [CDK](https://aws.amazon.com/cdk/)

#### AWS

- [AWS CDK by @KevinZhao (EKS based)](https://github.com/aws-samples/solution-for-deploying-dify-on-aws)
- [AWS CDK by @tmokmss (ECS based)](https://github.com/aws-samples/dify-self-hosted-on-aws)

### Alibaba Cloud

[Alibaba Cloud Computing Nest](https://computenest.console.aliyun.com/service/instance/create/default?type=user&ServiceName=Dify%E7%A4%BE%E5%8C%BA%E7%89%88)

### Alibaba Cloud Data Management

Z enim klikom namestite Dify na Alibaba Cloud z [Alibaba Cloud Data Management](https://www.alibabacloud.com/help/en/dms/dify-in-invitational-preview/)

### Uporaba Azure Devops Pipeline za uvajanje v AKS

Z enim klikom namestite Dify v AKS z uporabo [Azure Devops Pipeline Helm Chart by @LeoZhang](https://github.com/Ruiruiz30/Dify-helm-chart-AKS)

### Namestitev s Sealos

Z enim klikom namestite Dify prek [Sealos App Store](https://sealos.io/products/app-store/dify/)
