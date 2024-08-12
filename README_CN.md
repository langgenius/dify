![cover-v5-optimized](https://github.com/langgenius/dify/assets/13230914/f9e19af5-61ba-4119-b926-d10c4c06ebab)

<div align="center">
  <a href="https://cloud.dify.ai">Dify 云服务</a> ·
  <a href="https://docs.dify.ai/getting-started/install-self-hosted">自托管</a> ·
  <a href="https://docs.dify.ai">文档</a> ·
  <a href="https://udify.app/chat/22L1zSxg6yW1cWQg">（需用英文）常见问题解答 / 联系团队</a>
</div>

<p align="center">
    <a href="https://dify.ai" target="_blank">
        <img alt="Static Badge" src="https://img.shields.io/badge/Product-F04438"></a>
    <a href="https://dify.ai/pricing" target="_blank">
        <img alt="Static Badge" src="https://img.shields.io/badge/free-pricing?logo=free&color=%20%23155EEF&label=pricing&labelColor=%20%23528bff"></a>
    <a href="https://discord.gg/FngNHpbcY7" target="_blank">
        <img src="https://img.shields.io/discord/1082486657678311454?logo=discord&labelColor=%20%235462eb&logoColor=%20%23f5f5f5&color=%20%235462eb"
            alt="chat on Discord"></a>
    <a href="https://twitter.com/intent/follow?screen_name=dify_ai" target="_blank">
        <img src="https://img.shields.io/twitter/follow/dify_ai?logo=X&color=%20%23f5f5f5"
            alt="follow on Twitter"></a>
    <a href="https://hub.docker.com/u/langgenius" target="_blank">
        <img alt="Docker Pulls" src="https://img.shields.io/docker/pulls/langgenius/dify-web?labelColor=%20%23FDB062&color=%20%23f79009"></a>
    <a href="https://github.com/langgenius/dify/graphs/commit-activity" target="_blank">
        <img alt="Commits last month" src="https://img.shields.io/github/commit-activity/m/langgenius/dify?labelColor=%20%2332b583&color=%20%2312b76a"></a>
    <a href="https://github.com/langgenius/dify/" target="_blank">
        <img alt="Issues closed" src="https://img.shields.io/github/issues-search?query=repo%3Alanggenius%2Fdify%20is%3Aclosed&label=issues%20closed&labelColor=%20%237d89b0&color=%20%235d6b98"></a>
    <a href="https://github.com/langgenius/dify/discussions/" target="_blank">
        <img alt="Discussion posts" src="https://img.shields.io/github/discussions/langgenius/dify?labelColor=%20%239b8afb&color=%20%237a5af8"></a>
</p>

<div align="center">
  <a href="./README.md"><img alt="README in English" src="https://img.shields.io/badge/English-d9d9d9"></a>
  <a href="./README_CN.md"><img alt="简体中文版自述文件" src="https://img.shields.io/badge/简体中文-d9d9d9"></a>
  <a href="./README_JA.md"><img alt="日本語のREADME" src="https://img.shields.io/badge/日本語-d9d9d9"></a>
  <a href="./README_ES.md"><img alt="README en Español" src="https://img.shields.io/badge/Español-d9d9d9"></a>
  <a href="./README_FR.md"><img alt="README en Français" src="https://img.shields.io/badge/Français-d9d9d9"></a>
  <a href="./README_KL.md"><img alt="README tlhIngan Hol" src="https://img.shields.io/badge/Klingon-d9d9d9"></a>
  <a href="./README_KR.md"><img alt="README in Korean" src="https://img.shields.io/badge/한국어-d9d9d9"></a>
  <a href="./README_AR.md"><img alt="README بالعربية" src="https://img.shields.io/badge/العربية-d9d9d9"></a>
  <a href="./README_TR.md"><img alt="Türkçe README" src="https://img.shields.io/badge/Türkçe-d9d9d9"></a>
  <a href="./README_VI.md"><img alt="README Tiếng Việt" src="https://img.shields.io/badge/Ti%E1%BA%BFng%20Vi%E1%BB%87t-d9d9d9"></a>
</div>


#

<div align="center">
  <a href="https://trendshift.io/repositories/2152" target="_blank"><img src="https://trendshift.io/api/badge/repositories/2152" alt="langgenius%2Fdify | 趋势转变" style="width: 250px; height: 55px;" width="250" height="55"/></a>
</div>

Dify 是一个开源的 LLM 应用开发平台。其直观的界面结合了 AI 工作流、RAG 管道、Agent、模型管理、可观测性功能等，让您可以快速从原型到生产。以下是其核心功能列表：
</br> </br>

**1. 工作流**: 
  在画布上构建和测试功能强大的 AI 工作流程，利用以下所有功能以及更多功能。


  https://github.com/langgenius/dify/assets/13230914/356df23e-1604-483d-80a6-9517ece318aa



**2. 全面的模型支持**: 
  与数百种专有/开源 LLMs 以及数十种推理提供商和自托管解决方案无缝集成，涵盖 GPT、Mistral、Llama3 以及任何与 OpenAI API 兼容的模型。完整的支持模型提供商列表可在[此处](https://docs.dify.ai/getting-started/readme/model-providers)找到。

![providers-v5](https://github.com/langgenius/dify/assets/13230914/5a17bdbe-097a-4100-8363-40255b70f6e3)


**3. Prompt IDE**: 
  用于制作提示、比较模型性能以及向基于聊天的应用程序添加其他功能（如文本转语音）的直观界面。

**4. RAG Pipeline**: 
  广泛的 RAG 功能，涵盖从文档摄入到检索的所有内容，支持从 PDF、PPT 和其他常见文档格式中提取文本的开箱即用的支持。

**5. Agent 智能体**: 
  您可以基于 LLM 函数调用或 ReAct 定义 Agent，并为 Agent 添加预构建或自定义工具。Dify 为 AI Agent 提供了50多种内置工具，如谷歌搜索、DALL·E、Stable Diffusion 和 WolframAlpha 等。

**6. LLMOps**: 
  随时间监视和分析应用程序日志和性能。您可以根据生产数据和标注持续改进提示、数据集和模型。

**7. 后端即服务**: 
  所有 Dify 的功能都带有相应的 API，因此您可以轻松地将 Dify 集成到自己的业务逻辑中。


## 功能比较
<table style="width: 100%;">
  <tr>
    <th align="center">功能</th>
    <th align="center">Dify.AI</th>
    <th align="center">LangChain</th>
    <th align="center">Flowise</th>
    <th align="center">OpenAI Assistant API</th>
  </tr>
  <tr>
    <td align="center">编程方法</td>
    <td align="center">API + 应用程序导向</td>
    <td align="center">Python 代码</td>
    <td align="center">应用程序导向</td>
    <td align="center">API 导向</td>
  </tr>
  <tr>
    <td align="center">支持的 LLMs</td>
    <td align="center">丰富多样</td>
    <td align="center">丰富多样</td>
    <td align="center">丰富多样</td>
    <td align="center">仅限 OpenAI</td>
  </tr>
  <tr>
    <td align="center">RAG引擎</td>
    <td align="center">✅</td>
    <td align="center">✅</td>
    <td align="center">✅</td>
    <td align="center">✅</td>
  </tr>
  <tr>
    <td align="center">Agent</td>
    <td align="center">✅</td>
    <td align="center">✅</td>
    <td align="center">❌</td>
    <td align="center">✅</td>
  </tr>
  <tr>
    <td align="center">工作流</td>
    <td align="center">✅</td>
    <td align="center">❌</td>
    <td align="center">✅</td>
    <td align="center">❌</td>
  </tr>
  <tr>
    <td align="center">可观测性</td>
    <td align="center">✅</td>
    <td align="center">✅</td>
    <td align="center">❌</td>
    <td align="center">❌</td>
  </tr>
  <tr>
    <td align="center">企业功能（SSO/访问控制）</td>
    <td align="center">✅</td>
    <td align="center">❌</td>
    <td align="center">❌</td>
    <td align="center">❌</td>
  </tr>
  <tr>
    <td align="center">本地部署</td>
    <td align="center">✅</td>
    <td align="center">✅</td>
    <td align="center">✅</td>
    <td align="center">❌</td>
  </tr>
</table>

## 使用 Dify

- **云 </br>**
我们提供[ Dify 云服务](https://dify.ai)，任何人都可以零设置尝试。它提供了自部署版本的所有功能，并在沙盒计划中包含 200 次免费的 GPT-4 调用。

- **自托管 Dify 社区版</br>**
使用这个[入门指南](#quick-start)快速在您的环境中运行 Dify。
使用我们的[文档](https://docs.dify.ai)进行进一步的参考和更深入的说明。

- **面向企业/组织的 Dify</br>**
我们提供额外的面向企业的功能。[给我们发送电子邮件](mailto:business@dify.ai?subject=[GitHub]Business%20License%20Inquiry)讨论企业需求。 </br>
  > 对于使用 AWS 的初创公司和中小型企业，请查看 [AWS Marketplace 上的 Dify 高级版](https://aws.amazon.com/marketplace/pp/prodview-t22mebxzwjhu6)，并使用一键部署到您自己的 AWS VPC。它是一个价格实惠的 AMI 产品，提供了使用自定义徽标和品牌创建应用程序的选项。

## 保持领先

在 GitHub 上给 Dify Star，并立即收到新版本的通知。

![star-us](https://github.com/langgenius/dify/assets/13230914/b823edc1-6388-4e25-ad45-2f6b187adbb4)

## 安装社区版

### 系统要求

在安装 Dify 之前，请确保您的机器满足以下最低系统要求：

- CPU >= 2 Core
- RAM >= 4GB

### 快速启动

启动 Dify 服务器的最简单方法是运行我们的 [docker-compose.yml](docker/docker-compose.yaml) 文件。在运行安装命令之前，请确保您的机器上安装了 [Docker](https://docs.docker.com/get-docker/) 和 [Docker Compose](https://docs.docker.com/compose/install/)：

```bash
cd docker
cp .env.example .env
docker compose up -d
```

运行后，可以在浏览器上访问 [http://localhost/install](http://localhost/install) 进入 Dify 控制台并开始初始化安装操作。

### 自定义配置

如果您需要自定义配置，请参考 [.env.example](docker/.env.example) 文件中的注释，并更新 `.env` 文件中对应的值。此外，您可能需要根据您的具体部署环境和需求对 `docker-compose.yaml` 文件本身进行调整，例如更改镜像版本、端口映射或卷挂载。完成任何更改后，请重新运行 `docker-compose up -d`。您可以在[此处](https://docs.dify.ai/getting-started/install-self-hosted/environments)找到可用环境变量的完整列表。

#### 使用 Helm Chart 部署

使用 [Helm Chart](https://helm.sh/) 版本或者 YAML 文件，可以在 Kubernetes 上部署 Dify。

- [Helm Chart by @LeoQuote](https://github.com/douban/charts/tree/master/charts/dify)
- [Helm Chart by @BorisPolonsky](https://github.com/BorisPolonsky/dify-helm)
- [YAML 文件 by @Winson-030](https://github.com/Winson-030/dify-kubernetes)

#### 使用 Terraform 部署

##### Azure Global
使用 [terraform](https://www.terraform.io/) 一键部署 Dify 到 Azure。
- [Azure Terraform by @nikawang](https://github.com/nikawang/dify-azure-terraform)

## Star History

[![Star History Chart](https://api.star-history.com/svg?repos=langgenius/dify&type=Date)](https://star-history.com/#langgenius/dify&Date)


## Contributing

对于那些想要贡献代码的人，请参阅我们的[贡献指南](https://github.com/langgenius/dify/blob/main/CONTRIBUTING.md)。
同时，请考虑通过社交媒体、活动和会议来支持 Dify 的分享。

> 我们正在寻找贡献者来帮助将Dify翻译成除了中文和英文之外的其他语言。如果您有兴趣帮助，请参阅我们的[i18n README](https://github.com/langgenius/dify/blob/main/web/i18n/README.md)获取更多信息，并在我们的[Discord社区服务器](https://discord.gg/8Tpq4AcN9c)的`global-users`频道中留言。

**Contributors**

<a href="https://github.com/langgenius/dify/graphs/contributors">
  <img src="https://contrib.rocks/image?repo=langgenius/dify" />
</a>

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
