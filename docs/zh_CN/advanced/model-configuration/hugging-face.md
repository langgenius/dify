# 接入 Hugging Face 上的开源模型

Dify 支持 Hugging Face 上类型是 text-generation 和 text2text-generation 类型的模型。
具体步骤如下：

1. 你需要有 Hugging Face 账号([注册地址](https://huggingface.co/join))。
2. 设置 Hugging Face 的 API key([获取地址](https://huggingface.co/settings/tokens))。
3. 选择模型，进入 [Hugging Face 模型列表页](https://huggingface.co/models?pipeline_tag=text-generation\&sort=trending)，筛选类型是 [text-generation](https://huggingface.co/models?pipeline_tag=text-generation\&sort=trending) 和 [text2text-generation](https://huggingface.co/models?pipeline_tag=text2text-generation\&sort=trending) 的模型。

<figure><img src="../../.gitbook/assets/image (14).png" alt=""><figcaption></figcaption></figure>


Dify 支持用两种方式接入 Hugging Face 上的模型：

1. Hosted Inference API。这种方式是用的 Hugging Face 官方部署的模型。不需要付费。但缺点是，只有少量模型支持这种方式。
2. Inference Endpiont。这种方式是用 Hugging Face 接入的 AWS 等资源来部署模型，需要付费。

### 接入 Hosted Inference API 的模型

#### 1 选择模型

模型详情页右侧有包含 Hosted inference API 的 区域才支持 Hosted inference API 。如下图所：

<figure><img src="../../.gitbook/assets/image (7).png" alt=""><figcaption></figcaption></figure>

在模型详情页，可以获得模型的名称。


<figure><img src="../../.gitbook/assets/image (8).png" alt=""><figcaption></figcaption></figure>

#### 2 在 Dify 中使用接入模型

在 `设置 > 模型供应商 > Hugging Face` 的 Endpoint Type 选择 Hosted Inference API。如下图所示：

<figure><img src="../../.gitbook/assets/image (9).png" alt=""><figcaption></figcaption></figure>

API Token 为文章开头设置的 API Key。模型名字为上一步获得的模型名字。

### 方式2: Inference Endpiont

#### 1 选择要部署模型

模型详情页右侧的 `Deploy按钮` 下有 Inference Endpionts 选项的模型才支持 Inference Endpiont。如下图所示：


<figure><img src="../../.gitbook/assets/image (10).png" alt=""><figcaption></figcaption></figure>

#### 2 部署模型

点击模型的部署按钮，选择 Inference Endpiont 选项。如果之前没绑过银行卡的，会需要绑卡。按流程走即可。绑过卡后，会出现下面的界面：按需求修改配置，点击左下角的 Create Endpoint 来创建 Inference Endpiont。

<figure><img src="../../.gitbook/assets/image (11).png" alt=""><figcaption></figcaption></figure>

模型部署好后，就可以看到 Endpoint URL。

<figure><img src="../../.gitbook/assets/image (13).png" alt=""><figcaption></figcaption></figure>

#### 3 在 Dify 中使用接入模型

在 `设置 > 模型供应商 > Hugging Face` 的 Endpoint Type 选择 Inference Endpoints。如下图所示：

<figure><img src="../../.gitbook/assets/image (12).png" alt=""><figcaption></figcaption></figure>

API Token 为文章开头设置的 API Key。模型名字随便起。Endpoint URL 为 上一步部署模型成功后获得的 Endpoint URL。

