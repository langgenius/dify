# 构建一个 Notion AI 助手

_作者：阿乔. Dify 用户_

### 概述

Notion 是一个强大的知识管理工具。它的灵活性和可扩展性使其成为一个出色的个人知识库和共享工作空间。许多人使用它来存储他们的知识，并与他人协作，促进思想交流和新知识的创造。

然而，这些知识仍然是静态的，因为用户必须搜索他们需要的信息并阅读其中的内容才能找到他们寻求的答案。这个过程既不特别高效，也不智能。 你是否曾经梦想过拥有一个基于你的 Notion 库的 AI 助手？这个助手不仅可以帮助你审查知识库，还可以像一位经验丰富的管家一样参与交流，甚至回答其他人的问题，就好像你是自己的个人 Notion 库的主人一样。

### 如何实现自己的 Notion AI 助手?

现在，你可以通过 Dify 来实现这个梦想。Dify 是一个开源的 LLMOps（大型语言模型运维）平台。 ChatGPT 和 Claude 等大型语言模型已经利用其强大的能力改变了世界。它们的强大学习能力主要归功于丰富的训练数据。幸运的是，它们已经发展到足够智能的程度，可以从你提供的内容中进行学习，从而使从个人 Notion 库中生成创意成为现实。 在没有 Dify 的情况下，你可能需要熟悉 langchain，这是一个简化组装这些要素过程的抽象概念。

### 如何使用Dify创建自己的AI助手?

训练Notion AI助手的过程非常简单。您只需要按照如下步骤操作:

1.登录 Dify。

2.创建一个数据集。

3.将 Notion 和数据集连接起来。

4.开始训练。

5.创建自己的AI应用程序。

#### 1. 登录 Dify[​](https://wsyfin.com/notion-dify#1-login-to-dify) <a href="#1-login-to-dify" id="1-login-to-dify"></a>

点击这里登录到 Dify。你可以使用你的 GitHub 或 Google 账户方便地登录。

> 如果你使用 GitHub 账户登录，不妨给这个[项目](https://github.com/langgenius/dify)点个星星吧？这真的对我们有很大的支持！

![login-1](https://pan.wsyfin.com/f/ERGcp/login-1.png)

#### 2.创建新的数据集  <a href="#2-create-a-new-datasets" id="2-create-a-new-datasets"></a>

点击顶部侧边栏的 "Datasets" 按钮，然后点击 "Create Dataset" 按钮。

![login-2](https://pan.wsyfin.com/f/G6ziA/login-2.png)

#### 3. 与 Notion 和您的数据集进行连接  <a href="#3-connect-with-notion-and-datasets" id="3-connect-with-notion-and-datasets"></a>

选择 "Sync from Notion"，然后点击 "Connect" 按钮。

![connect-with-notion-1](https://pan.wsyfin.com/f/J6WsK/connect-with-notion-1.png)

然后，您将被重定向到 Notion 登录页面。使用您的 Notion 帐户登录。使用您的 Notion 帐户登录。

![connect-with-notion-2](https://pan.wsyfin.com/f/KrEi4/connect-with-notion-2.png)

检查 Dify 所需的权限，然后单击“选择页面”按钮。

![connect-with-notion-3](https://pan.wsyfin.com/f/L91iQ/connect-with-notion-3.png)

选择你要和 Dify 同步的页面，然后点击“允许访问”按钮。

![connect-with-notion-4](https://pan.wsyfin.com/f/M8Xtz/connect-with-notion-4.png)

#### 4. 开始训练  <a href="#4-start-training" id="4-start-training"></a>

指定需要让 AI 学习的页面，使其能够理解 Notion 中这个部分的内容。然后点击 "下一步" 按钮。

![train-1](https://pan.wsyfin.com/f/Nkjuj/train-1.png)

我们建议选择 "自动" 和 "高质量" 的选项来训练你的 AI 助手。然后点击 "保存并处理" 按钮。

![train-2](https://pan.wsyfin.com/f/OYoCv/train-2.png)

等待几秒钟，embedding 处理进程完成。

![train-3](https://pan.wsyfin.com/f/PN9F3/train-3.png)

#### 5. 创建你自己的 AI 应用程序[​](https://wsyfin.com/notion-dify#5-create-your-own-ai-application) <a href="#5-create-your-own-ai-application" id="5-create-your-own-ai-application"></a>

你需要创建一个AI应用，然后连接刚刚创建的数据集。返回到仪表板，然后点击“创建新应用”按钮。建议直接使用聊天应用。

![create-app-1](https://pan.wsyfin.com/f/QWRHo/create-app-1.png)

选择“Prompt Eng.”并在“context”中添加你的 Notion 数据集。

![create-app-2](https://pan.wsyfin.com/f/R6DT5/create-app-2.png)

我建议在你的 AI 应用程序中添加一个「预设提示」。就像咒语对于哈利·波特来说是必不可少的一样，某些工具或功能可以极大地增强 AI 应用程序的能力。

例如，如果你的 Notion 笔记主要关注软件开发中的问题解决，可以在其中一个提示中写道：

> 我希望你能在我的 Notion 工作区中扮演一个 IT 专家的角色，利用你对计算机科学、网络基础设施、Notion 笔记和 IT 安全的知识来解决问题。

<figure><img src="../.gitbook/assets/image (34).png" alt=""><figcaption></figcaption></figure>

建议初始时启用 AI 主动提供用户一个起始句子，给出可以询问的线索。此外，激活「语音转文字」功能可以让用户通过语音与你的 AI 助手进行互动。

<figure><img src="../.gitbook/assets/image (42).png" alt=""><figcaption></figcaption></figure>

现在您可以在“概览”中单击公共 URL 聊天与您自己的 AI 助手！

<figure><img src="../.gitbook/assets/image (27).png" alt=""><figcaption></figcaption></figure>

### 通过API集成到您的项目中​

通过 Dify 打造的每个 AI 应用程序都可以通过其 API 进行访问。这种方法允许开发人员直接利用前端应用程序中强大的大型语言模型（LLM）的特性，提供真正的“后端即服务”（BaaS）体验。

通过无缝的 API 集成，您可以方便地调用您的 Notion AI 应用程序，无需复杂的配置。

在概览页面上点击「API 参考」按钮。您可以将其作为您应用程序的 API 文档参考。

![using-api-1](https://pan.wsyfin.com/f/wp0Cy/using-api-1.png)

#### 1. 生成 API 密钥 <a href="#1-generate-api-secret-key" id="1-generate-api-secret-key"></a>

为了安全起见，建议生成 API 密钥以访问您的 AI 应用。

![using-api-2](https://pan.wsyfin.com/f/xk2Fx/using-api-2.png)

#### 2.检索会话ID <a href="#2-retrieve-conversation-id" id="2-retrieve-conversation-id"></a>

与 AI 应用程序聊天后，您可以从“Logs & Ann.”页面检索会话 ID。

![using-api-3](https://pan.wsyfin.com/f/yPXHL/using-api-3.png)

#### 3. 调用API <a href="#3-invoke-api" id="3-invoke-api"></a>

您可以在API文档上运行示例请求代码来调用终端中的AI应用程序。

记住替换代码中的SECRET KEY和conversation_id。

您可以在第一次输入空的conversation_id，在收到包含conversation_id的响应后将其替换。

```
curl --location --request POST 'https://api.dify.ai/v1/chat-messages' \
--header 'Authorization: Bearer ENTER-YOUR-SECRET-KEY' \
--header 'Content-Type: application/json' \
--data-raw '{
    "inputs": {},
    "query": "eh",
    "response_mode": "streaming",
    "conversation_id": "",
    "user": "abc-123"
}'
```

在终端中发送请求，您将获得成功的响应。

![using-api-4](https://pan.wsyfin.com/f/zpnI4/using-api-4.png)

如果您想继续此聊天，请将请求代码的`conversation_id`替换为您从响应中获得的`conversation_id`。

你可以在`"Logs & Ann "`页面查看所有的对话记录。

![using-api-5](https://pan.wsyfin.com/f/ADQSE/using-api-5.png)

### 周期性地与 Notion 同步

如果你的 Notion 页面更新了，你可以定期与 Dify 同步，让你的人工智能助手保持最新状态。你的人工智能助手将从新内容中学习并回答新问题。

![create-app-5](https://pan.wsyfin.com/f/XDBfO/create-app-5.png)

### 总结

在本教程中，我们不仅学会了如何将您的 Notion 数据导入到 Dify 中，还学会了如何使用 API 将其与您的项目集成。

Dify 是一个用户友好的 LLMOps 平台，旨在赋予更多人创建可持续的 AI 原生应用程序的能力。通过为各种应用类型设计的可视化编排，Dify 提供了可供使用的应用程序，可以帮助您利用数据打造独特的 AI 助手。如果您有任何疑问，请随时与我们联系。
