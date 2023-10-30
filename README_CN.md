![](./images/describe-cn.jpg)
<p align="center">
  <a href="./README.md">English</a> |
  <a href="./README_CN.md">简体中文</a> |
  <a href="./README_JA.md">日本語</a> |
  <a href="./README_ES.md">Español</a>
</p>


####  [官方网站](https://dify.ai) •  [使用文档](https://docs.dify.ai/v/zh-hans)  · [部署文档](https://docs.dify.ai/v/zh-hans/getting-started/install-self-hosted)  ·  [FAQ](https://docs.dify.ai/v/zh-hans/getting-started/faq) • [Twitter](https://twitter.com/dify_ai) •  [Discord](https://discord.gg/FngNHpbcY7)

**Dify** 是一个易用的 LLMOps 平台，基于不同的大型语言模型能力，让更多人可以简易地创建可持续运营的原生 AI 应用。Dify 提供多种类型应用的可视化编排，应用可开箱即用，也能以“后端即服务”的 API 提供服务。

通过 Dify 创建的应用包含了：

- 开箱即用的的 Web 站点，支持表单模式和聊天对话模式
- 一套 API 即可包含插件、上下文增强等能力，替你省下了后端代码的编写工作
- 可视化的对应用进行数据分析，查阅日志或进行标注

https://github.com/langgenius/dify/assets/100913391/f6e658d5-31b3-4c16-a0af-9e191da4d0f6

## 核心能力
1. **模型支持：** 你可以在 Dify 上选择基于不同模型的能力来开发你的 AI 应用。Dify 兼容 Langchain，这意味着我们将逐步支持多种 LLMs ，目前支持的模型供应商：

- [x] **OpenAI**：GPT4、GPT3.5-turbo、GPT3.5-turbo-16k、text-davinci-003 
- [x] **Azure OpenAI Service**
- [x] **Anthropic**：Claude2、Claude-instant
- [x] **Replicate**
- [x] **Hugging Face Hub**
- [x] **ChatGLM**
- [x] **Llama2**
- [x] **MiniMax**
- [x] **讯飞星火大模型**
- [x] **文心一言**
- [x] **通义千问**


我们为所有注册云端版的用户免费提供以下资源（登录 [dify.ai](https://cloud.dify.ai) 即可使用）：
* 200 次 OpenAI 模型的消息调用额度，用于创建基于 OpenAI 模型的 AI 应用
* 300 万 讯飞星火大模型 Token 的调用额度，用于创建基于讯飞星火大模型的 AI 应用
* 100 万 MiniMax Token 的调用额度，用于创建基于 MiniMax 模型的 AI 应用
2. **可视化编排 Prompt：** 通过界面化编写 prompt 并调试，只需几分钟即可发布一个 AI 应用。
3. **文本 Embedding 处理（数据集）**：全自动完成文本预处理，使用你的数据作为上下文，无需理解晦涩的概念和技术处理。支持 PDF、txt 等文件格式，支持从 Notion、网页、API 同步数据。
4. **基于 API 开发：** 后端即服务。您可以直接访问网页应用，也可以接入 API 集成到您的应用中，无需关注复杂的后端架构和部署过程。
5. **插件能力：** Dify 「智聊」平台已支持网页浏览、Google 搜索、Wikipedia 查询等第一方插件，可在对话中实现联网搜索、分析网页内容、展示 AI 的推理过程。
6. **团队 Workspace：** 团队成员可加入 Workspace 编辑、管理和使用团队内的 AI 应用。
6. **数据标注与改进：** 可视化查阅 AI 应用日志并对数据进行改进标注，观测 AI 的推理过程，不断提高其性能。（Coming soon）
 -----------------------------
 ## Use cases
 * [几分钟创建一个带有业务数据的官网 AI 智能客服](https://docs.dify.ai/v/zh-hans/use-cases/create-an-ai-chatbot-with-business-data-in-minutes)
 * [构建一个 Notion AI 助手](https://docs.dify.ai/v/zh-hans/use-cases/build-an-notion-ai-assistant)
 * [创建 Midjoureny 提示词机器人](https://docs.dify.ai/v/zh-hans/use-cases/create-a-midjoureny-prompt-word-robot-with-zero-code)


## 使用云服务

访问 [Dify.ai](https://cloud.dify.ai) 使用云端版。

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

### Helm Chart

非常感谢 @BorisPolonsky 为我们提供了一个 [Helm Chart](https://helm.sh/) 版本，可以在 Kubernetes 上部署 Dify。
您可以前往 https://github.com/BorisPolonsky/dify-helm 来获取部署信息。

### 配置

需要自定义配置，请参考我们的 [docker-compose.yml](docker/docker-compose.yaml) 文件中的注释，并手动设置环境配置，修改完毕后，请再次执行 `docker-compose up -d`。

## Roadmap

我们正在开发中的功能：

- **数据集**，支持更多的数据集，通过网页、API 同步内容。用户可以根据自己的数据源构建 AI 应用程序。
- **插件**，我们将发布符合 ChatGPT 标准的插件，支持更多 Dify 自己的插件，支持用户自定义插件能力，以在应用程序中启用更多功能，例如以支持以目标为导向的分解推理任务。

## Q&A

**Q: 我能用 Dify 做什么？**

A: Dify 是一个简单且能力丰富的 LLM 开发和运营工具。你可以用它搭建商用级应用，个人助理。如果你想自己开发应用，Dify 也能为你省下接入 OpenAI 的后端工作，使用我们逐步提供的可视化运营能力，你可以持续的改进和训练你的 GPT 模型。

**Q: 如何使用 Dify “训练”自己的模型？**

A: 一个有价值的应用由 Prompt Engineering、上下文增强和 Fine-tune 三个环节组成。我们创造了一种 Prompt 结合编程语言的 Hybrid 编程方式（类似一个模版引擎），你可以轻松的完成长文本嵌入，或抓取用户输入的一个 Youtube 视频的字幕——这些都将作为上下文提交给 LLMs 进行计算。我们十分注重应用的可运营性，你的用户在使用 App 期间产生的数据，可进行分析、标记和持续训练。以上环节如果没有好的工具支持，可能会消耗你大量的时间。

**Q: 如果要创建一个自己的应用，我需要准备什么？**

A: 我们假定你已经有了 OpenAI 或 Claude 等模型的 API Key，如果没有请去注册一个。如果你已经有了一些内容可以作为训练上下文，就太好了。

**Q: 提供哪些界面语言？**

A:  支持英文、中文，你可以为我们贡献语言包并提供维护支持。

## Star History

[![Star History Chart](https://api.star-history.com/svg?repos=langgenius/dify&type=Date)](https://star-history.com/#langgenius/dify&Date)


## 贡献

我们欢迎你为 Dify 作出贡献帮助 Dify 变得更好。我们欢迎各种方式的贡献，提交代码、问题、新想法、或者分享你基于 Dify 创建出的各种有趣有用的 AI 应用。同时，我们也欢迎你在不同的活动、研讨会、社交媒体上分享 Dify。

### 贡献代码
为了确保正确审查，所有代码贡献 - 包括来自具有直接提交更改权限的贡献者 - 都必须提交 PR 请求并在合并分支之前得到核心开发人员的批准。

我们欢迎所有人提交 PR！如果您愿意提供帮助，可以在 [贡献指南](CONTRIBUTING_CN.md) 中了解有关如何为项目做出代码贡献的更多信息。

### 提交问题或想法
你可以通过 Dify 代码仓库新增 issues 来提交你的问题或想法。如遇到问题，请尽可能描述你遇到问题的操作步骤，以便我们更好地发现它。如果你对我们的产品有任何新想法，也欢迎向我们反馈，请尽可能多地分享你的见解，以便我们在社区中获得更多反馈和进一步讨论。

### 分享你的应用
我们鼓励所有社区成员分享他们基于 Dify 创造出的 AI 应用，它们可以是应用于不同情景或不同用户，这将有助于为希望基于 AI 能力创造的人们提供强大灵感！你可以通过 [Dify-user-case 仓库项目提交 issue](https://github.com/langgenius/dify-user-case) 来分享你的应用案例。

### 向别人分享 Dify
我们鼓励社区贡献者们积极展示你使用 Dify 的不同角度。你可以通过线下研讨会、博客或社交媒体上谈论或分享你使用 Dify 的任意功能，相信你独特的使用分享会给别人带来非常大的帮助！如果你需要任何指导帮助，欢迎联系我们 support@dify.ai ,你也可以在 twitter @Dify.AI 或在 [Discord 社区](https://discord.gg/FngNHpbcY7)交流来帮助你传播信息。

### 帮助别人
你还可以在 Discord、GitHub issues或其他社交平台上帮助需要帮助的人，指导别人解决使用过程中遇到的问题和分享使用经验。这也是个非常了不起的贡献！如果你希望成为 Dify 社区的维护者，请通过[Discord 社区](https://discord.gg/FngNHpbcY7) 联系官方团队或邮件联系我们 support@dify.ai.


## 联系我们

如果您有任何问题、建议或合作意向，欢迎通过以下方式联系我们：

- 在我们的 [GitHub Repo](https://github.com/langgenius/dify) 上提交 Issue 或 PR
- 在我们的 [Discord 社区](https://discord.gg/FngNHpbcY7) 上加入讨论
- 发送邮件至 hello@dify.ai

## 安全

为了保护您的隐私，请避免在 GitHub 上发布安全问题。发送问题至 security@dify.ai，我们将为您做更细致的解答。

## Citation

本软件使用了以下开源软件：

- Chase, H. (2022). LangChain [Computer software]. https://github.com/hwchase17/langchain

更多信息，请参考相应软件的官方网站或许可证文本。

## License

本仓库遵循 [Dify Open Source License](LICENSE) 开源协议。
