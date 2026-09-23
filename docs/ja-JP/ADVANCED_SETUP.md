# 高度なセットアップ

設定をカスタマイズする必要がある場合は、[.env.example](../../docker/.env.example) ファイルのコメントを参照し、`.env` ファイルの対応する値を更新してください。さらに、デプロイ環境や要件に応じて、`docker-compose.yaml` ファイル自体を調整する必要がある場合があります。たとえば、イメージのバージョン、ポートのマッピング、ボリュームのマウントなどを変更します。変更を加えた後は、`docker-compose up -d` を再実行してください。利用可能な環境変数の全一覧は、[こちら](https://docs.dify.ai/getting-started/install-self-hosted/environments)で確認できます。

## Grafanaを使用したメトリクス監視

Grafanaにダッシュボードをインポートし、DifyのPostgreSQLデータベースをデータソースとして使用して、アプリ、テナント、メッセージなどの粒度でメトリクスを監視します。

- [@bowenliang123によるGrafanaダッシュボード](https://github.com/bowenliang123/dify-grafana-dashboard)

## Kubernetesでのデプロイ

高可用性設定を設定する必要がある場合、コミュニティは[Helm Charts](https://helm.sh/)とYAMLファイルにより、DifyをKubernetesにデプロイすることができます。

- [Helm Chart by @LeoQuote](https://github.com/douban/charts/tree/master/charts/dify)
- [Helm Chart by @BorisPolonsky](https://github.com/BorisPolonsky/dify-helm)
- [Helm Chart by @magicsong](https://github.com/magicsong/ai-charts)
- [YAML file by @Winson-030](https://github.com/Winson-030/dify-kubernetes)
- [YAML file by @wyy-holding](https://github.com/wyy-holding/dify-k8s)
- [🚀 新着！YAML ファイル（Dify v1.6.0 対応）by @Zhoneym](https://github.com/Zhoneym/DifyAI-Kubernetes)

### Terraformを使用したデプロイ

[terraform](https://www.terraform.io/) を使用して、ワンクリックでDifyをクラウドプラットフォームにデプロイします

#### Azure Global

- [@nikawangによるAzure Terraform](https://github.com/nikawang/dify-azure-terraform)

#### Google Cloud

- [@sotazumによるGoogle Cloud Terraform](https://github.com/DeNA/dify-google-cloud-terraform)

### AWS CDK を使用したデプロイ

[CDK](https://aws.amazon.com/cdk/) を使用して、DifyをAWSにデプロイします

#### AWS

- [@KevinZhaoによるAWS CDK (EKS based)](https://github.com/aws-samples/solution-for-deploying-dify-on-aws)
- [@tmokmssによるAWS CDK (ECS based)](https://github.com/aws-samples/dify-self-hosted-on-aws)

### Alibaba Cloud

[Alibaba Cloud Computing Nest](https://computenest.console.aliyun.com/service/instance/create/default?type=user&ServiceName=Dify%E7%A4%BE%E5%8C%BA%E7%89%88)

### Alibaba Cloud Data Management

[Alibaba Cloud Data Management](https://www.alibabacloud.com/help/en/dms/dify-in-invitational-preview/) を利用して、DifyをAlibaba Cloudへワンクリックでデプロイできます

### AKSへのデプロイにAzure Devops Pipelineを使用

[Azure Devops Pipeline Helm Chart by @LeoZhang](https://github.com/Ruiruiz30/Dify-helm-chart-AKS)を使用してDifyをAKSにワンクリックでデプロイ

### Sealosを使用したデプロイ

[Sealos App Store](https://sealos.io/products/app-store/dify/)を使用してDifyをワンクリックでデプロイできます
