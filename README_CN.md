[![](./images/describe.png)](https://dify.ai)
<p align="center">
  <a href="./README.md">English</a> |
  <a href="./README_CN.md">简体中文</a> |
  <a href="./README_JA.md">日本語</a> |
  <a href="./README_ES.md">Español</a> |
  <a href="./README_KL.md">Klingon</a> |
  <a href="./README_FR.md">Français</a>
</p>

<p align="center">
    <a href="https://dify.ai" target="_blank">
        <img alt="Static Badge" src="https://img.shields.io/badge/AI-Dify?logo=AI&logoColor=%20%23f5f5f5&label=Dify&labelColor=%20%23155EEF&color=%23EAECF0"></a>
    <a href="https://discord.gg/FngNHpbcY7" target="_blank">
        <img src="https://img.shields.io/discord/1082486657678311454?logo=discord"
            alt="chat on Discord"></a>
    <a href="https://twitter.com/intent/follow?screen_name=dify_ai" target="_blank">
        <img src="https://img.shields.io/twitter/follow/dify_ai?style=social&logo=X"
            alt="follow on Twitter"></a>
    <a href="https://hub.docker.com/u/langgenius" target="_blank">
        <img alt="Docker Pulls" src="https://img.shields.io/docker/pulls/langgenius/dify-web"></a>
</p>

<p align="center">
   <a href="https://mp.weixin.qq.com/s/TnyfIuH-tPi9o1KNjwVArw" target="_blank">
   Dify 发布 AI Agent 能力：基于不同的大型语言模型构建 GPTs 和 Assistants
  </a>
</p>

Dify 是一个 LLM 应用开发平台，已经有超过 10 万个应用基于 Dify.AI 构建。它融合了 Backend as Service 和 LLMOps 的理念，涵盖了构建生成式 AI 原生应用所需的核心技术栈，包括一个内置 RAG 引擎。使用 Dify，你可以基于任何模型自部署类似 Assistants API 和 GPTs 的能力。

![](./images/demo.png)

## 使用云端服务

使用 [Dify.AI Cloud](https://dify.ai) 提供开源版本的所有功能,并包含 200 次 GPT 试用额度。

## 为什么选择 Dify

Dify 具有模型中立性，相较 LangChain 等硬编码开发库 Dify 是一个完整的、工程化的技术栈，而相较于 OpenAI 的 Assistants API 你可以完全将服务部署在本地。

| 功能 | Dify.AI | Assistants API | LangChain |
| --- | --- | --- | --- |
| 编程方式 | 面向 API | 面向 API | 面向 Python 代码 |
| 生态策略 | 开源 | 封闭且商用 | 开源 |
| RAG 引擎 | 支持 | 支持 | 不支持 |
| Prompt IDE | 包含 | 包含 | 没有 |
| 支持的 LLMs | 丰富 | 仅 GPT | 丰富 |
| 本地部署 | 支持 | 不支持 | 不适用 |


## 特点

![](./images/models.png)

**1. LLM支持**：与 OpenAI 的 GPT 系列模型集成,或者与开源的 Llama2 系列模型集成。事实上，Dify支持主流的商业模型和开源模型(本地部署或基于 MaaS)。

**2. Prompt IDE**：和团队一起在 Dify 协作，通过可视化的 Prompt 和应用编排工具开发 AI 应用。 支持无缝切换多种大型语言模型。

**3. RAG引擎**：包括各种基于全文索引或向量数据库嵌入的 RAG 能力，允许直接上传 PDF、TXT 等各种文本格式。

**4. AI Agent**：基于 Function Calling 和 ReAct 的 Agent 推理框架，允许用户自定义工具，所见即所得。Dify 提供了十多种内置工具调用能力，如谷歌搜索、DELL·E、Stable Diffusion、WolframAlpha 等。

**5. 持续运营**：监控和分析应用日志和性能，使用生产数据持续改进 Prompt、数据集或模型。

## 在开始之前

**关注我们，您将立即收到 GitHub 上所有新发布版本的通知！**

![star-us](https://github.com/langgenius/dify/assets/100913391/95f37259-7370-4456-a9f0-0bc01ef8642f)

- [网站](https://dify.ai)
- [文档](https://docs.dify.ai)
- [部署文档](https://docs.dify.ai/getting-started/install-self-hosted)
- [常见问题](https://docs.dify.ai/getting-started/faq)

## 安装社区版

### 系统要求

在安装 Dify 之前，请确保您的机器满足以下最低系统要求：

- CPU >= 2 Core
- RAM >= 4GB

### 快速启动

启动 Dify 服务器的最简单方法是运行我们的 [docker-compose.yml](docker/docker-compose.yaml) 文件。在运行安装命令之前，请确保您的机器上安装了 [Docker](https://docs.docker.com/get-docker/) 和 [Docker Compose](https://docs.docker.com/compose/install/)：

```bash
cd docker
docker compose up -d
```

运行后，可以在浏览器上访问 [http://localhost/install](http://localhost/install) 进入 Dify 控制台并开始初始化安装操作。

#### 使用 Helm Chart 部署

使用 [Helm Chart](https://helm.sh/) 版本，可以在 Kubernetes 上部署 Dify。

- [Helm Chart by @LeoQuote](https://github.com/douban/charts/tree/master/charts/dify)
- [Helm Chart by @BorisPolonsky](https://github.com/BorisPolonsky/dify-helm)

### 配置

如果您需要自定义配置，请参考我们的 [docker-compose.yml](docker/docker-compose.yaml) 文件中的注释，并手动设置环境配置。更改后，请再次运行 `docker-compose up -d`。您可以在我们的[文档](https://docs.dify.ai/getting-started/install-self-hosted/environments)中查看所有环境变量的完整列表。

## Star History

[![Star History Chart](https://api.star-history.com/svg?repos=langgenius/dify&type=Date)](https://star-history.com/#langgenius/dify&Date)


## 社区与支持

我们欢迎您为 Dify 做出贡献，以帮助改善 Dify。包括：提交代码、问题、新想法，或分享您基于 Dify 创建的有趣且有用的 AI 应用程序。同时，我们也欢迎您在不同的活动、会议和社交媒体上分享 Dify。

- [Github Discussion](https://github.com/langgenius/dify/discussions). 👉：分享您的应用程序并与社区交流。
- [GitHub Issues](https://github.com/langgenius/dify/issues)。👉：使用 Dify.AI 时遇到的错误和问题，请参阅[贡献指南](CONTRIBUTING.md)。
- [电子邮件支持](mailto:hello@dify.ai?subject=[GitHub]Questions%20About%20Dify)。👉：关于使用 Dify.AI 的问题。
- [Discord](https://discord.gg/FngNHpbcY7)。👉：分享您的应用程序并与社区交流。
- [Twitter](https://twitter.com/dify_ai)。👉：分享您的应用程序并与社区交流。
- [商业许可](mailto:business@dify.ai?subject=[GitHub]Business%20License%20Inquiry)。👉：有关商业用途许可 Dify.AI 的商业咨询。
 - [微信]() 👉：扫描下方二维码，添加微信好友，备注 Dify，我们将邀请您加入 Dify 社区。  
<img src="./images/wechat.png" alt="wechat" width="100"/>

## 安全问题

为了保护您的隐私，请避免在 GitHub 上发布安全问题。发送问题至 security@dify.ai，我们将为您做更细致的解答。

## License

本仓库遵循 [Dify Open Source License](LICENSE) 开源协议，该许可证本质上是 Apache 2.0，但有一些额外的限制。
