所以你想为 Dify 做贡献 - 这太棒了，我们迫不及待地想看到你的贡献。作为一家人员和资金有限的初创公司，我们有着雄心勃勃的目标，希望设计出最直观的工作流程来构建和管理 LLM 应用程序。社区的任何帮助都是宝贵的。

考虑到我们的现状，我们需要灵活快速地交付，但我们也希望确保像你这样的贡献者在贡献过程中获得尽可能顺畅的体验。我们为此编写了这份贡献指南，旨在让你熟悉代码库和我们与贡献者的合作方式，以便你能快速进入有趣的部分。

这份指南，就像 Dify 本身一样，是一个不断改进的工作。如果有时它落后于实际项目，我们非常感谢你的理解，并欢迎任何反馈以供我们改进。

在许可方面，请花一分钟阅读我们简短的[许可证和贡献者协议](./LICENSE)。社区还遵守[行为准则](https://github.com/langgenius/.github/blob/main/CODE_OF_CONDUCT.md)。

## 在开始之前

[查找](https://github.com/langgenius/dify/issues?q=is:issue+is:closed)现有问题，或[创建](https://github.com/langgenius/dify/issues/new/choose)一个新问题。我们将问题分为两类：

### 功能请求：

* 如果您要提出新的功能请求，请解释所提议的功能的目标，并尽可能提供详细的上下文。[@perzeusss](https://github.com/perzeuss)制作了一个很好的[功能请求助手](https://udify.app/chat/MK2kVSnw1gakVwMX)，可以帮助您起草需求。随时尝试一下。

* 如果您想从现有问题中选择一个，请在其下方留下评论表示您的意愿。

相关方向的团队成员将参与其中。如果一切顺利，他们将批准您开始编码。在此之前，请不要开始工作，以免我们提出更改导致您的工作付诸东流。

根据所提议的功能所属的领域不同，您可能需要与不同的团队成员交流。以下是我们团队成员目前正在从事的各个领域的概述：

  | Member                                                       | Scope                                                |
  | ------------------------------------------------------------ | ---------------------------------------------------- |
  | [@yeuoly](https://github.com/Yeuoly)                         | Architecting Agents                                  |
  | [@jyong](https://github.com/JohnJyong)                       | RAG pipeline design                                  |
  | [@GarfieldDai](https://github.com/GarfieldDai)               | Building workflow orchestrations                     |
  | [@iamjoel](https://github.com/iamjoel) & [@zxhlyh](https://github.com/zxhlyh) | Making our frontend a breeze to use                  |
  | [@guchenhe](https://github.com/guchenhe) & [@crazywoola](https://github.com/crazywoola) | Developer experience, points of contact for anything |
  | [@takatost](https://github.com/takatost)                     | Overall product direction and architecture           |

  How we prioritize:

  | Feature Type                                                 | Priority        |
  | ------------------------------------------------------------ | --------------- |
  | High-Priority Features as being labeled by a team member     | High Priority   |
  | Popular feature requests from our [community feedback board](https://github.com/langgenius/dify/discussions/categories/feedbacks) | Medium Priority |
  | Non-core features and minor enhancements                     | Low Priority    |
  | Valuable but not immediate                                   | Future-Feature  |

### 其他任何事情（例如bug报告、性能优化、拼写错误更正）：
* 立即开始编码。

  How we prioritize:

  | Issue Type                                                   | Priority        |
  | ------------------------------------------------------------ | --------------- |
  | Bugs in core functions (cannot login, applications not working, security loopholes) | Critical        |
  | Non-critical bugs, performance boosts                        | Medium Priority |
  | Minor fixes (typos, confusing but working UI)                | Low Priority    |


## 安装

以下是设置Dify进行开发的步骤：

### 1. Fork该仓库

### 2. 克隆仓库

从终端克隆fork的仓库：

```
git clone git@github.com:<github_username>/dify.git
```

### 3. 验证依赖项

Dify 依赖以下工具和库：

- [Docker](https://www.docker.com/)
- [Docker Compose](https://docs.docker.com/compose/install/)
- [Node.js v18.x (LTS)](http://nodejs.org)
- [npm](https://www.npmjs.com/) version 8.x.x or [Yarn](https://yarnpkg.com/)
- [Python](https://www.python.org/) version 3.10.x

### 4. 安装

Dify由后端和前端组成。通过`cd api/`导航到后端目录，然后按照[后端README](api/README.md)进行安装。在另一个终端中，通过`cd web/`导航到前端目录，然后按照[前端README](web/README.md)进行安装。

查看[安装常见问题解答](https://docs.dify.ai/getting-started/faq/install-faq)以获取常见问题列表和故障排除步骤。

### 5. 在浏览器中访问Dify

为了验证您的设置，打开浏览器并访问[http://localhost:3000](http://localhost:3000)（默认或您自定义的URL和端口）。现在您应该看到Dify正在运行。

## 开发

如果您要添加模型提供程序，请参考[此指南](https://github.com/langgenius/dify/blob/main/api/core/model_runtime/README.md)。

如果您要向Agent或Workflow添加工具提供程序，请参考[此指南](./api/core/tools/README.md)。

为了帮助您快速了解您的贡献在哪个部分，以下是Dify后端和前端的简要注释大纲：

### 后端

Dify的后端使用Python编写，使用[Flask](https://flask.palletsprojects.com/en/3.0.x/)框架。它使用[SQLAlchemy](https://www.sqlalchemy.org/)作为ORM，使用[Celery](https://docs.celeryq.dev/en/stable/getting-started/introduction.html)作为任务队列。授权逻辑通过Flask-login进行处理。

```
[api/]
├── constants             // Constant settings used throughout code base.
├── controllers           // API route definitions and request handling logic.           
├── core                  // Core application orchestration, model integrations, and tools.
├── docker                // Docker & containerization related configurations.
├── events                // Event handling and processing
├── extensions            // Extensions with 3rd party frameworks/platforms.
├── fields                // field definitions for serialization/marshalling.
├── libs                  // Reusable libraries and helpers.
├── migrations            // Scripts for database migration.
├── models                // Database models & schema definitions.
├── services              // Specifies business logic.
├── storage               // Private key storage.      
├── tasks                 // Handling of async tasks and background jobs.
└── tests
```

### 前端

该网站使用基于Typescript的[Next.js](https://nextjs.org/)模板进行引导，并使用[Tailwind CSS](https://tailwindcss.com/)进行样式设计。[React-i18next](https://react.i18next.com/)用于国际化。

```
[web/]
├── app                   // layouts, pages, and components
│   ├── (commonLayout)    // common layout used throughout the app
│   ├── (shareLayout)     // layouts specifically shared across token-specific sessions 
│   ├── activate          // activate page
│   ├── components        // shared by pages and layouts
│   ├── install           // install page
│   ├── signin            // signin page
│   └── styles            // globally shared styles
├── assets                // Static assets
├── bin                   // scripts ran at build step
├── config                // adjustable settings and options 
├── context               // shared contexts used by different portions of the app
├── dictionaries          // Language-specific translate files 
├── docker                // container configurations
├── hooks                 // Reusable hooks
├── i18n                  // Internationalization configuration
├── models                // describes data models & shapes of API responses
├── public                // meta assets like favicon
├── service               // specifies shapes of API actions
├── test                  
├── types                 // descriptions of function params and return values
└── utils                 // Shared utility functions
```

## 提交你的 PR

最后，是时候向我们的仓库提交一个拉取请求（PR）了。对于重要的功能，我们首先将它们合并到 `deploy/dev` 分支进行测试，然后再合并到 `main` 分支。如果你遇到合并冲突或者不知道如何提交拉取请求的问题，请查看 [GitHub 的拉取请求教程](https://docs.github.com/en/pull-requests/collaborating-with-pull-requests)。

就是这样！一旦你的 PR 被合并，你将成为我们 [README](https://github.com/langgenius/dify/blob/main/README.md) 中的贡献者。

## 获取帮助

如果你在贡献过程中遇到困难或者有任何问题，可以通过相关的 GitHub 问题提出你的疑问，或者加入我们的 [Discord](https://discord.gg/8Tpq4AcN9c) 进行快速交流。
