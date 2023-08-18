# 模型配置

Dify 目前已支持主流的模型供应商，例如 OpenAI 的 GPT 系列。以下是我们目前支持的模型供应商：

* OpenAI
* Azure OpenAI Service
* Anthropic
* Hugging Face Hub
* Replicate
* 讯飞星火
* 文心一言
* 通义千问
* Minimax
* ChatGLM

根据技术变化和用户需求，我们将陆续支持更多 LLM 供应商。

### 托管模型试用服务

我们为 Dify 云服务的用户提供了不同模型的试用额度，请在该额度耗尽前设置你自己的模型供应商，否则将会影响应用的正常使用。

* **OpenAI 托管模型试用：**我们提供 500 次调用次数供你试用体验，可用于 GPT3.5-turbo、GPT3.5-turbo-16k、text-davinci-003 模型。
* **Antropic Claude 托管模型试用：**我们提供 1000 次调用次数供你试用体验，可用于 Claude-instant-1、Claude2 模型。

### 模型类型

在 Dify 中，我们按模型的使用场景将模型分为以下 3 类：

1. 系统推理模型。在创建的应用中，用的是该类型的模型。智聊、对话名称生成、下一步问题建议用的也是推理模型。
2. Embedding 模型。在数据集中，将分段过的文档做 Embedding 用的是该类型的模型。在使用了数据集的应用中，将用户的提问做 Embedding 处理也是用的该类型的模型。
3. 语音转文字 模型。将对话型应用中，将语音转文字用的是该类型的模型。

### 设置默认模型

Dify 在需要模型时，会根据使用场景来选择设置过的默认模型。在 `设置 > 模型供应商` 中设置默认模型。


<figure><img src="../../.gitbook/assets/image (15).png" alt=""><figcaption></figcaption></figure>

### 接入模型设置

在 Dify 的 `设置 > 模型供应商` 中设置要接入的模型。

<figure><img src="../../.gitbook/assets/image (16).png" alt=""><figcaption></figcaption></figure>

模型供应商分为两种：

1. 自有模型。该类型的模型供应商提供的是自己开发的模型。如 OpenAI，Anthropic 等。
2. 托管模型。该类型的模型供应商提供的是第三方模型。如 Hugging Face，Replicate 等。


在 Dify 中接入不同类型的模型供应商的方式稍有不同。



**接入自有模型的模型供应商**

接入自有模型的供应商后，Dify 会自动接入该供应商下的所有模型。


在 Dify 中设置对应模型供应商的 API key，即可接入该模型供应商。获取模型供应商的 API 地址如下：

* OpenAI： [https://platform.openai.com/account/api-keys](https://platform.openai.com/account/api-keys)
* Anthropic：[https://console.anthropic.com/account/keys](https://console.anthropic.com/account/keys)
* 讯飞星火：[https://www.xfyun.cn/solutions/xinghuoAPI](https://www.xfyun.cn/solutions/xinghuoAPI)
* Minimax：[https://api.minimax.chat/user-center/basic-information/interface-key](https://api.minimax.chat/user-center/basic-information/interface-key)
* 文心一言：[https://console.bce.baidu.com/qianfan/ais/console/applicationConsole/application](https://console.bce.baidu.com/qianfan/ais/console/applicationConsole/application)
* 通义千问：[https://dashscope.console.aliyun.com/api-key_management?spm=a2c4g.11186623.0.0.3bbc424dxZms9k](https://dashscope.console.aliyun.com/api-key_management?spm=a2c4g.11186623.0.0.3bbc424dxZms9k)
* ChatGLM：该模型供应商并未提供官方的服务。但支持自部署([部署文档](https://github.com/THUDM/ChatGLM2-6B#%E7%8E%AF%E5%A2%83%E5%AE%89%E8%A3%85))。

{% hint style="info" %}
Dify 使用了 [PKCS1_OAEP](https://pycryptodome.readthedocs.io/en/latest/src/cipher/oaep.html) 来加密存储用户托管的 API 密钥，每个租户均使用了独立的密钥对进行加密，确保你的 API 密钥不被泄漏。
{% endhint %}

**接入托管模型的模型供应商**

托管类型的供应商上面有很多第三方模型。接入模型需要一个个的添加。具体接入方式如下：

* [Hugging Face](hugging-face.md)。
* [Replicate](replicate.md)。



### 使用模型

配置完模型后，就可以在应用中使用这些模型了：

<figure><img src="../../.gitbook/assets/image.png" alt=""><figcaption></figcaption></figure>

