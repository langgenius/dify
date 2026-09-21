# उन्नत सेटअप

## कस्टम कॉन्फ़िगरेशन

यदि आपको कॉन्फ़िगरेशन को कस्टमाइज़ करने की आवश्यकता है, तो कृपया हमारी [.env.example](../../docker/.env.example) फ़ाइल में दिए गए टिप्पणियों (comments) को देखें और अपने `.env` फ़ाइल में संबंधित मानों को अपडेट करें।\
इसके अतिरिक्त, आपको अपने विशेष डिप्लॉयमेंट वातावरण और आवश्यकताओं के आधार पर `docker-compose.yaml` फ़ाइल में भी बदलाव करने की आवश्यकता हो सकती है, जैसे इमेज संस्करण, पोर्ट मैपिंग या वॉल्यूम माउंट्स बदलना।\
कोई भी बदलाव करने के बाद, कृपया `docker-compose up -d` कमांड को पुनः चलाएँ।\
उपलब्ध सभी environment variables की पूरी सूची [here](https://docs.dify.ai/getting-started/install-self-hosted/environments) पर पाई जा सकती है।

## Grafana के साथ मेट्रिक्स मॉनिटरिंग

Grafana में Dify के PostgreSQL डेटाबेस को डेटा स्रोत के रूप में उपयोग करते हुए डैशबोर्ड आयात करें, ताकि आप ऐप्स, टेनेंट्स, संदेशों आदि के स्तर पर मेट्रिक्स की निगरानी कर सकें।

- [Grafana Dashboard by @bowenliang123](https://github.com/bowenliang123/dify-grafana-dashboard)

## Kubernetes के साथ डिप्लॉयमेंट

यदि आप उच्च उपलब्धता (high-availability) सेटअप कॉन्फ़िगर करना चाहते हैं, तो समुदाय द्वारा योगदान किए गए [Helm Charts](https://helm.sh/) और YAML फ़ाइलें उपलब्ध हैं जो Dify को Kubernetes पर डिप्लॉय करने की अनुमति देती हैं।

- [Helm Chart by @LeoQuote](https://github.com/douban/charts/tree/master/charts/dify)
- [Helm Chart by @BorisPolonsky](https://github.com/BorisPolonsky/dify-helm)
- [Helm Chart by @magicsong](https://github.com/magicsong/ai-charts)
- [YAML file by @Winson-030](https://github.com/Winson-030/dify-kubernetes)
- [YAML file by @wyy-holding](https://github.com/wyy-holding/dify-k8s)
- [🚀 NEW! YAML files (Supports Dify v1.6.0) by @Zhoneym](https://github.com/Zhoneym/DifyAI-Kubernetes)

### डिप्लॉयमेंट के लिए Terraform का उपयोग

[terraform](https://www.terraform.io/) का उपयोग करके एक क्लिक में Dify को क्लाउड प्लेटफ़ॉर्म पर डिप्लॉय करें।

#### Azure Global

- [Azure Terraform by @nikawang](https://github.com/nikawang/dify-azure-terraform)

#### Google Cloud

- [Google Cloud Terraform by @sotazum](https://github.com/DeNA/dify-google-cloud-terraform)

### डिप्लॉयमेंट के लिए AWS CDK का उपयोग

[CDK](https://aws.amazon.com/cdk/) का उपयोग करके Dify को AWS पर डिप्लॉय करें।

#### AWS

- [AWS CDK by @KevinZhao (EKS आधारित)](https://github.com/aws-samples/solution-for-deploying-dify-on-aws)
- [AWS CDK by @tmokmss (ECS आधारित)](https://github.com/aws-samples/dify-self-hosted-on-aws)

### Alibaba Cloud Computing Nest का उपयोग

[Alibaba Cloud Computing Nest](https://computenest.console.aliyun.com/service/instance/create/default?type=user&ServiceName=Dify%E7%A4%BE%E5%8C%BA%E7%89%88) के साथ Dify को Alibaba Cloud पर तेज़ी से डिप्लॉय करें।

### Alibaba Cloud Data Management का उपयोग

[Alibaba Cloud Data Management](https://www.alibabacloud.com/help/en/dms/dify-in-invitational-preview/) के साथ एक क्लिक में Dify को Alibaba Cloud पर डिप्लॉय करें।

### Azure Devops Pipeline के साथ AKS पर डिप्लॉय करें

[Azure Devops Pipeline Helm Chart by @LeoZhang](https://github.com/Ruiruiz30/Dify-helm-chart-AKS) के साथ एक क्लिक में Dify को AKS पर डिप्लॉय करें।

### Sealos के साथ डिप्लॉय करें

[Sealos App Store](https://sealos.io/products/app-store/dify/) के साथ एक क्लिक में Dify को डिप्लॉय करें।
