# উন্নত সেটআপ

যদি আপনার কনফিগারেশনটি কাস্টমাইজ করার প্রয়োজন হয়, তাহলে অনুগ্রহ করে আমাদের [.env.example](../../docker/.env.example) ফাইল দেখুন এবং আপনার `.env` ফাইলে সংশ্লিষ্ট মানগুলি আপডেট করুন। এছাড়াও, আপনার নির্দিষ্ট এনভায়রনমেন্ট এবং প্রয়োজনীয়তার উপর ভিত্তি করে আপনাকে `docker-compose.yaml` ফাইলে সমন্বয় করতে হতে পারে, যেমন ইমেজ ভার্সন পরিবর্তন করা, পোর্ট ম্যাপিং করা, অথবা ভলিউম মাউন্ট করা।
যেকোনো পরিবর্তন করার পর, অনুগ্রহ করে `docker-compose up -d` পুনরায় চালান। ভেরিয়েবলের সম্পূর্ণ তালিকা [এখানে] (https://docs.dify.ai/getting-started/install-self-hosted/environments) খুঁজে পেতে পারেন।

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
