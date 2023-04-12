<p align="center">
  <a href="./README.md">English</a> |
  <a href="./README_CN.md">简体中文</a>
</p>

[官方网站](http://langgenius.ai) • [文档](https://docs.langgenius.ai/zh-hans) • [Twitter](https://twitter.com/langgeniusai)

**LangGenius** 是一个易用的 LLMOps 平台，旨在让更多人可以创建可持续运营的原生 AI 应用。LangGenius 提供多种类型应用的可视化编排，应用可开箱即用，也能以“后端即服务”的 API 提供服务。

## 使用云服务

访问 [LangGenius.ai](http://cloug.langgenius.ai)

## 安装社区版

我们的社区版还在准备中，预计在 2 周内发布到 Github。你可以提前 Star 本项目。

---

通过 LangGenius 创建的应用包含了：

- 开箱即用的的 Web 站点，支持表单模式和聊天对话模式
- 一套 API 即可包含插件、上下文增强等能力，替你省下了后端代码的编写工作
- 可视化的对应用进行数据分析，查阅日志或进行标注

LangGenius 兼容 Langchain，这意味着我们将逐步支持多种 LLMs ，目前已支持：

- GPT 3 (text-davinci-003)
- GPT 3.5 Turbo(ChatGPT)
- GPT-4

## Roadmap

我们正在开发中的功能：

- **数据集**，基于你自己的数据嵌入到 AI 应用，包括文本、网页甚至 Notion 的内容
- **插件**，为应用引入 ChatGPT Plugin 规范的插件，或使用 LangGenius 出品的插件

## Q&A

**Q: 我能用 LangGenius 做什么？**

A: LangGenius 是一个简单且能力丰富的 LLM 开发和运营工具。你可以用它搭建商用级应用，个人助理。如果你想自己开发应用，LangGenius 也能为你省下接入 OpenAI 的后端工作，使用我们逐步提供的可视化运营能力，你可以持续的改进和训练你的 GPT 模型。

**Q: 如何使用 LangGenius “训练”自己的模型？**

A: 一个有价值的应用由 Prompt Engineering、上下文增强和 Fine-tune 三个环节组成。我们创造了一种 Prompt 结合编程语言的 Hybrid 编程方式（类似一个模版引擎），你可以轻松的完成长文本嵌入，或抓取用户输入的一个 Youtube 视频的字幕——这些都将作为上下文提交给 LLMs 进行计算。我们十分注重应用的可运营性，你的用户在使用 App 期间产生的数据，可进行分析、标记和持续训练。以上环节如果没有好的工具支持，可能会消耗你大量的时间。

**Q: 如果要创建一个自己的应用，我需要准备什么？**

A: 我们假定你已经有了 OpenAI API Key，如果没有请去注册一个。如果你已经有了一些内容可以作为训练上下文，就太好了。

**Q: 提供哪些界面语言？**

A: 现已支持英文与中文，你可以为我们贡献语言包。

## 关于我们

LangGenius 项目由腾讯云 DevOps 前团队成员创作。我们发现基于 OpenAI 的 API 开发 GPT 应用有些繁琐。借由我们多年对开发者效率工具的研发经验，希望让更多人都能通过自然语言开发出有趣的 App。

**联系我们**

如果您有任何问题、建议或合作意向，欢迎通过以下方式联系我们：

- 在我们的 [GitHub Repo](https://github.com/LangGenius) 上提交 Issue 或 PR
- 在我们的 [Discord 社区](https://discord.gg/AhzKf7dNgk) 上加入讨论
- 发送邮件至 hello@langgenius.ai