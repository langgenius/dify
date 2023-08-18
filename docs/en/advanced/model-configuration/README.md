# Model Configuration

Dify currently supports major model providers such as OpenAI's GPT series. Here are the model providers we currently support:

* OpenAI
* Azure OpenAI Service
* Anthropic
* Hugging Face Hub
* Replicate
* iFLYTEK SPARK
* WENXINYIYAN
* TONGYI
* MINIMAX
* ChatGLM

Based on technology developments and user needs, we will continue adding support for more LLM providers over time.

### Trial Hosted Models

We provide trial quotas for different models for Dify cloud service users. Please set up your own model provider before the trial quota runs out, otherwise it may impact normal use of your application.

* **OpenAI hosted model trial:** We provide 500 free call credits for you to try out GPT3.5-turbo, GPT3.5-turbo-16k, text-davinci-003 models.
* **Anthropic Claude hosted model trial:** We provide 1000 free call credits for you to try out Claude-instant-1, Claude2 models.

### Model type

In Dify, we divide models into the following 3 categories according to their usage scenarios:

1. System Reasoning Model. In the created application, this type of model is used. Smart chat, dialogue name generation, and next question suggestions also use reasoning models.
2. Embedding Model. In the dataset, this type of model is used to embedding segmented documents. In applications that use data sets, this type of model is also used to process user questions as Embedding.
3. Speech-to-Text model. In conversational applications, this type of model is used to convert speech to text.

### Set default model

When Dify needs a model, it will select the set default model according to the usage scenario. Set the default model in `Settings > Model Provider`.

<figure><img src="../../.gitbook/assets/image (82).png" alt=""><figcaption></figcaption></figure>

### Access model settings

Set the model to be imported in Dify's `Settings > Model Provider`.

![](<../../.gitbook/assets/image (83).png>)

There are two types of model suppliers:

1. Own model. Model suppliers of this type provide models developed by themselves. Such as OpenAI, Anthropic, etc.
2. Hosting model. This type of model provider provides third-party models. Such as Hugging face, Replicate, etc.

The different types of model suppliers are accessed slightly differently in Dify.



### Model suppliers that access their own models

After importing the supplier of its own model, Dify will automatically import all the models under the supplier.

Set the API key of the corresponding model provider in Dify to access the model provider. Get the API address of the model provider as follows:

* OpenAI： [https://platform.openai.com/account/api-keys](https://platform.openai.com/account/api-keys)
* Anthropic：[https://console.anthropic.com/account/keys](https://console.anthropic.com/account/keys)
* iFLYTEK SPARK：[https://www.xfyun.cn/solutions/xinghuoAPI](https://www.xfyun.cn/solutions/xinghuoAPI)
* MINIMAX：[https://api.minimax.chat/user-center/basic-information/interface-key](https://api.minimax.chat/user-center/basic-information/interface-key)
* WENXINYIYAN：[https://console.bce.baidu.com/qianfan/ais/console/applicationConsole/application](https://console.bce.baidu.com/qianfan/ais/console/applicationConsole/application)
* TONGYI：[https://dashscope.console.aliyun.com/api-key_management?spm=a2c4g.11186623.0.0.3bbc424dxZms9k](https://dashscope.console.aliyun.com/api-key_management?spm=a2c4g.11186623.0.0.3bbc424dxZms9k)
* ChatGLM: This model provider does not provide official services. But self-deployment is supported ([deployment docs](https://github.com/THUDM/ChatGLM2-6B/blob/main/README_EN.md#environment-setup)).

{% hint style="info" %}
Dify uses [PKCS1_OAEP](https://pycryptodome.readthedocs.io/en/latest/src/cipher/oaep.html) to encrypt and store user-managed API keys, and each tenant uses an independent key pair for encryption to ensure that your API keys are not leaked.
{% endhint %}

### Model suppliers that access hosted models

There are many third-party models on hosting type providers. Access models need to be added one by one. The specific access method is as follows:

* [Hugging Face](hugging-face.md).
* [Replicate](replicate.md).

### Use model

Once you have configured your models, you can use them in your application:

<figure><img src="../../.gitbook/assets/image (84).png" alt=""><figcaption></figcaption></figure>
