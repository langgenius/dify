# الإعداد المتقدم

إذا كنت بحاجة إلى تخصيص الإعدادات، فيرجى الرجوع إلى التعليقات في ملف [.env.example](../../docker/.env.example) وتحديث القيم المقابلة في ملف `.env`. بالإضافة إلى ذلك، قد تحتاج إلى إجراء تعديلات على ملف `docker-compose.yaml` نفسه، مثل تغيير إصدارات الصور أو تعيينات المنافذ أو نقاط تحميل وحدات التخزين، بناءً على بيئة النشر ومتطلباتك الخاصة. بعد إجراء أي تغييرات، يرجى إعادة تشغيل `docker-compose up -d`. يمكنك العثور على قائمة كاملة بمتغيرات البيئة المتاحة [هنا](https://docs.dify.ai/getting-started/install-self-hosted/environments).

## مراقبة المقاييس باستخدام Grafana

استيراد لوحة التحكم إلى Grafana، باستخدام قاعدة بيانات PostgreSQL الخاصة بـ Dify كمصدر للبيانات، لمراقبة المقاييس بدقة للتطبيقات والمستأجرين والرسائل وغير ذلك.

- [لوحة تحكم Grafana بواسطة @bowenliang123](https://github.com/bowenliang123/dify-grafana-dashboard)

## النشر باستخدام Kubernetes

يوجد مجتمع خاص بـ [Helm Charts](https://helm.sh/) وملفات YAML التي تسمح بتنفيذ Dify على Kubernetes للنظام من الإيجابيات العلوية.

- [رسم بياني Helm من قبل @LeoQuote](https://github.com/douban/charts/tree/master/charts/dify)
- [رسم بياني Helm من قبل @BorisPolonsky](https://github.com/BorisPolonsky/dify-helm)
- [رسم بياني Helm من قبل @magicsong](https://github.com/magicsong/ai-charts)
- [ملف YAML من قبل @Winson-030](https://github.com/Winson-030/dify-kubernetes)
- [ملف YAML من قبل @wyy-holding](https://github.com/wyy-holding/dify-k8s)
- [🚀 جديد! ملفات YAML (تدعم Dify v1.6.0) بواسطة @Zhoneym](https://github.com/Zhoneym/DifyAI-Kubernetes)

### استخدام Terraform للتوزيع

انشر Dify إلى منصة السحابة بنقرة واحدة باستخدام [terraform](https://www.terraform.io/)

#### Azure Global

- [Azure Terraform بواسطة @nikawang](https://github.com/nikawang/dify-azure-terraform)

#### Google Cloud

- [Google Cloud Terraform بواسطة @sotazum](https://github.com/DeNA/dify-google-cloud-terraform)

### استخدام AWS CDK للنشر

انشر Dify على AWS باستخدام [CDK](https://aws.amazon.com/cdk/)

#### AWS

- [AWS CDK بواسطة @KevinZhao (EKS based)](https://github.com/aws-samples/solution-for-deploying-dify-on-aws)
- [AWS CDK بواسطة @tmokmss (ECS based)](https://github.com/aws-samples/dify-self-hosted-on-aws)

### استخدام Alibaba Cloud للنشر

[بسرعة نشر Dify إلى سحابة علي بابا مع عش الحوسبة السحابية علي بابا](https://computenest.console.aliyun.com/service/instance/create/default?type=user&ServiceName=Dify%E7%A4%BE%E5%8C%BA%E7%89%88)

### استخدام Alibaba Cloud Data Management للنشر

انشر ​​Dify على علي بابا كلاود بنقرة واحدة باستخدام [Alibaba Cloud Data Management](https://www.alibabacloud.com/help/en/dms/dify-in-invitational-preview/)

### استخدام Azure Devops Pipeline للنشر على AKS

انشر Dify على AKS بنقرة واحدة باستخدام [Azure Devops Pipeline Helm Chart by @LeoZhang](https://github.com/Ruiruiz30/Dify-helm-chart-AKS)

### استخدام Sealos للنشر

انشر Dify بنقرة واحدة باستخدام [Sealos App Store](https://sealos.io/products/app-store/dify/)
