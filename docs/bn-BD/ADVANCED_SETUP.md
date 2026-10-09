# উন্নত সেটআপ

স্থানীয় সেটিংস `docker/.env`-এ পরিবর্তন করুন। [`.env.example`](../../docker/.env.example)-এ ডিফল্ট ডেপ্লয়মেন্টের প্রয়োজনীয় মান থাকে; ঐচ্ছিক ও পরিষেবা-নির্দিষ্ট সেটিংস [`docker/envs/`](../../docker/envs/)-এ রয়েছে। প্রয়োজনীয় টেমপ্লেটের `.example` প্রত্যয় বাদ দিয়ে কপি করুন। `.env`-এর মান অগ্রাধিকার পায়। পরিবর্তনের পরে `docker/` থেকে `docker compose up -d` চালান। [Docker নির্দেশিকা](../../docker/README.md) দেখুন।

## Grafana দিয়ে মেট্রিক্স মনিটরিং

Dify-এর PostgreSQL ডাটাবেসকে ডেটা সোর্স হিসাবে ব্যবহার করে, অ্যাপ, টেন্যান্ট, মেসেজ ইত্যাদির গ্র্যানুলারিটিতে মেট্রিক্স মনিটর করার জন্য Grafana-তে ড্যাশবোর্ড ইম্পোর্ট করুন।

- [@bowenliang123 কর্তৃক Grafana ড্যাশবোর্ড](https://github.com/bowenliang123/dify-grafana-dashboard)

## Kubernetes এর সাথে ডেপ্লয়মেন্ট

যদি আপনি একটি হাইলি এভেইলেবল সেটআপ কনফিগার করতে চান, তাহলে কমিউনিটি [Helm Charts](https://helm.sh/) এবং YAML ফাইল রয়েছে যা Dify কে Kubernetes-এ ডিপ্লয় করার প্রক্রিয়া বর্ণনা করে।

- [Helm Chart by @LeoQuote](https://github.com/douban/charts/tree/master/charts/dify)
- [Helm Chart by @BorisPolonsky](https://github.com/BorisPolonsky/dify-helm)
- [Helm Chart by @magicsong](https://github.com/magicsong/ai-charts)
- [YAML file by @Winson-030](https://github.com/Winson-030/dify-kubernetes)
- [YAML file by @wyy-holding](https://github.com/wyy-holding/dify-k8s)
- [🚀 নতুন! YAML ফাইলসমূহ (Dify v1.6.0 সমর্থিত) তৈরি করেছেন @Zhoneym](https://github.com/Zhoneym/DifyAI-Kubernetes)

### টেরাফর্ম ব্যবহার করে ডিপ্লয়

[terraform](https://www.terraform.io/) ব্যবহার করে এক ক্লিকেই ক্লাউড প্ল্যাটফর্মে Dify ডিপ্লয় করুন।

#### অ্যাজুর গ্লোবাল

- [Azure Terraform by @nikawang](https://github.com/nikawang/dify-azure-terraform)

#### গুগল ক্লাউড

- [Google Cloud Terraform by @sotazum](https://github.com/DeNA/dify-google-cloud-terraform)

### AWS CDK ব্যবহার করে ডিপ্লয়

[CDK](https://aws.amazon.com/cdk/) দিয়ে AWS-এ Dify ডিপ্লয় করুন

#### AWS

- [AWS CDK by @KevinZhao (EKS based)](https://github.com/aws-samples/solution-for-deploying-dify-on-aws)
- [AWS CDK by @tmokmss (ECS based)](https://github.com/aws-samples/dify-self-hosted-on-aws)

### Alibaba Cloud ব্যবহার করে ডিপ্লয়

[Alibaba Cloud Computing Nest](https://computenest.console.aliyun.com/service/instance/create/default?type=user&ServiceName=Dify%E7%A4%BE%E5%8C%BA%E7%89%88)

### Alibaba Cloud Data Management ব্যবহার করে ডিপ্লয়

[Alibaba Cloud Data Management](https://www.alibabacloud.com/help/en/dms/dify-in-invitational-preview/)

### AKS-এ ডিপ্লয় করার জন্য Azure Devops Pipeline ব্যবহার

[Azure Devops Pipeline Helm Chart by @LeoZhang](https://github.com/Ruiruiz30/Dify-helm-chart-AKS) ব্যবহার করে Dify কে AKS-এ এক ক্লিকে ডিপ্লয় করুন

### Sealos ব্যবহার করে ডিপ্লয়

[Sealos App Store](https://sealos.io/products/app-store/dify/) ব্যবহার করে Dify-কে এক ক্লিকে ডিপ্লয় করুন
