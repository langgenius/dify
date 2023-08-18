# 基于 APIs 开发

Dify 基于“**后端即服务**”理念为所有应用提供了 API，为 AI 应用开发者带来了诸多便利。通过这一理念，开发者可以直接在前端应用中获取大型语言模型的强大能力，而无需关注复杂的后端架构和部署过程。

### 使用 Dify API 的好处

* 让前端应用直接安全地调用 LLM 能力，省去后端服务的开发过程
* 在可视化的界面中设计应用，并在所有客户端中实时生效
* 对 LLM 供应商的基础能力进行了良好封装
* 随时切换 LLM 供应商，并对 LLM 的密钥进行集中管理
* 在可视化的界面中运营你的应用，例如分析日志、标注及观察用户活跃
* 持续为应用提供更多工具能力、插件能力和数据集

### 如何使用

选择一个应用，在应用（Apps）左侧导航中可以找到**访问 API（API Access）**。在该页面中你可以查看 Dify 提供的 API 文档，并管理可访问 API 的凭据。

<figure><img src="../.gitbook/assets/service-api-page.png" alt=""><figcaption><p>访问 API 文档</p></figcaption></figure>

例如你是一个咨询公司的开发部分，你可以基于公司的私有数据库提供 AI 能力给终端用户或开发者，但开发者无法掌握你的数据和 AI 逻辑设计，从而使得服务可以安全、可持续的交付并满足商业目的。

{% hint style="warning" %}
在最佳实践中，API 密钥应通过后端调用，而不是直接以明文暴露在前端代码或请求中，这样可以防止你的应用被滥用或攻击。
{% endhint %}

你可以为一个应用**创建多个访问凭据**，以实现交付给不同的用户或开发者。这意味着 API 的使用者虽然使用了应用开发者提供的 AI 能力，但背后的 Promp 工程、数据集和工具能力是经封装的。

### 文本生成型应用

可用于生成高质量文本的应用，例如生成文章、摘要、翻译等，通过调用 completion-messages 接口，发送用户输入得到生成文本结果。用于生成文本的模型参数和提示词模版取决于开发者在 Dify 提示词编排页的设置。

你可以在**应用 -> 访问 API** 中找到该应用的 API 文档与范例请求。

例如，创建文本补全信息的 API 的调用示例：

```
curl --location --request POST 'https://api.dify.dev/v1/completion-messages' \
--header 'Authorization: Bearer ENTER-YOUR-SECRET-KEY' \
--header 'Content-Type: application/json' \
--data-raw '{
    "inputs": {},
    "query": "Hi",
    "response_mode": "streaming",
    "user": "abc-123"
}'

```

### 对话型应用

可用于大部分场景的对话型应用，采用一问一答模式与用户持续对话。要开始一个对话请调用 chat-messages 接口，通过继续传入返回的 conversation_id 可持续保持该会话。

你可以在**应用 -> 访问 API** 中找到该应用的 API 文档与范例请求。

例如，发送对话信息的 API的调用示例：

```
curl --location --request POST 'https://api.dify.dev/v1/chat-messages' \
--header 'Authorization: Bearer ENTER-YOUR-SECRET-KEY' \
--header 'Content-Type: application/json' \
--data-raw '{
    "inputs": {},
    "query": "eh",
    "response_mode": "streaming",
    "conversation_id": "1c7e55fb-1ba2-4e10-81b5-30addcea2276"
    "user": "abc-123"
}'

```





