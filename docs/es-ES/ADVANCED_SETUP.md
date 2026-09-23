# Configuración avanzada

Si necesita personalizar la configuración, consulte los comentarios en nuestro archivo [.env.example](../../docker/.env.example) y actualice los valores correspondientes en su archivo `.env`. Además, es posible que deba realizar ajustes en el propio archivo `docker-compose.yaml`, como cambiar las versiones de las imágenes, las asignaciones de puertos o los montajes de volúmenes, según su entorno de implementación y requisitos específicos. Después de realizar cualquier cambio, vuelva a ejecutar `docker-compose up -d`. Puede encontrar la lista completa de variables de entorno disponibles [aquí](https://docs.dify.ai/getting-started/install-self-hosted/environments).

. Después de realizar los cambios, ejecuta `docker-compose up -d` nuevamente. Puedes ver la lista completa de variables de entorno [aquí](https://docs.dify.ai/getting-started/install-self-hosted/environments).

## Monitorización de Métricas con Grafana

Importe el panel a Grafana, utilizando la base de datos PostgreSQL de Dify como fuente de datos, para monitorizar métricas en granularidad de aplicaciones, inquilinos, mensajes y más.

- [Panel de Grafana por @bowenliang123](https://github.com/bowenliang123/dify-grafana-dashboard)

## Implementación con Kubernetes

Si desea configurar una configuración de alta disponibilidad, la comunidad proporciona [Gráficos Helm](https://helm.sh/) y archivos YAML, a través de los cuales puede desplegar Dify en Kubernetes.

- [Gráfico Helm por @LeoQuote](https://github.com/douban/charts/tree/master/charts/dify)
- [Gráfico Helm por @BorisPolonsky](https://github.com/BorisPolonsky/dify-helm)
- [Gráfico Helm por @magicsong](https://github.com/magicsong/ai-charts)
- [Ficheros YAML por @Winson-030](https://github.com/Winson-030/dify-kubernetes)
- [Ficheros YAML por @wyy-holding](https://github.com/wyy-holding/dify-k8s)
- [🚀 ¡NUEVO! Archivos YAML (compatible con Dify v1.6.0) por @Zhoneym](https://github.com/Zhoneym/DifyAI-Kubernetes)

### Uso de Terraform para el despliegue

Despliega Dify en una plataforma en la nube con un solo clic utilizando [terraform](https://www.terraform.io/)

#### Azure Global

- [Azure Terraform por @nikawang](https://github.com/nikawang/dify-azure-terraform)

#### Google Cloud

- [Google Cloud Terraform por @sotazum](https://github.com/DeNA/dify-google-cloud-terraform)

### Usando AWS CDK para el Despliegue

Despliegue Dify en AWS usando [CDK](https://aws.amazon.com/cdk/)

#### AWS

- [AWS CDK por @KevinZhao (EKS based)](https://github.com/aws-samples/solution-for-deploying-dify-on-aws)
- [AWS CDK por @tmokmss (ECS based)](https://github.com/aws-samples/dify-self-hosted-on-aws)

### Alibaba Cloud

[Alibaba Cloud Computing Nest](https://computenest.console.aliyun.com/service/instance/create/default?type=user&ServiceName=Dify%E7%A4%BE%E5%8C%BA%E7%89%88)

### Alibaba Cloud Data Management

Despliega Dify en Alibaba Cloud con un solo clic con [Alibaba Cloud Data Management](https://www.alibabacloud.com/help/en/dms/dify-in-invitational-preview/)

### Uso de Azure Devops Pipeline para implementar en AKS

Implementa Dify en AKS con un clic usando [Azure Devops Pipeline Helm Chart by @LeoZhang](https://github.com/Ruiruiz30/Dify-helm-chart-AKS)

### Implementación con Sealos

Despliega Dify con un solo clic desde [Sealos App Store](https://sealos.io/products/app-store/dify/)
