# 贡献

感谢您对 [Dify](https://dify.ai) 的兴趣，并希望您能够做出贡献！在开始之前，请先阅读[行为准则](https://github.com/langgenius/.github/blob/main/CODE_OF_CONDUCT.md)并查看[现有问题](https://github.com/langgenius/dify/issues)。
本文档介绍了如何设置开发环境以构建和测试 [Dify](https://dify.ai)。

### 安装依赖项

您需要在计算机上安装和配置以下依赖项才能构建 [Dify](https://dify.ai)：

- [Git](http://git-scm.com/)
- [Docker](https://www.docker.com/)
- [Docker Compose](https://docs.docker.com/compose/install/)
- [Node.js v18.x (LTS)](http://nodejs.org)
- [npm](https://www.npmjs.com/) 版本 8.x.x 或 [Yarn](https://yarnpkg.com/)
- [Python](https://www.python.org/) 版本 3.10.x

## 本地开发

要设置一个可工作的开发环境，只需 fork 项目的 git 存储库，并使用适当的软件包管理器安装后端和前端依赖项，然后创建并运行 docker-compose 堆栈。

### Fork存储库

您需要 fork [存储库](https://github.com/langgenius/dify)。

### 克隆存储库

克隆您在 GitHub 上 fork 的存储库：

```
git clone git@github.com:<github_username>/dify.git
```

### 安装后端

要了解如何安装后端应用程序，请参阅[后端 README](api/README.md)。

### 安装前端

要了解如何安装前端应用程序，请参阅[前端 README](web/README.md)。

### 在浏览器中访问 Dify

最后，您现在可以访问 [http://localhost:3000](http://localhost:3000) 在本地环境中查看 [Dify](https://dify.ai)。

## 创建拉取请求

在进行更改后，打开一个拉取请求（PR）。提交拉取请求后，Dify 团队/社区的其他人将与您一起审查它。

如果遇到问题，比如合并冲突或不知道如何打开拉取请求，请查看 GitHub 的[拉取请求教程](https://docs.github.com/en/pull-requests/collaborating-with-pull-requests)，了解如何解决合并冲突和其他问题。一旦您的 PR 被合并，您将自豪地被列为[贡献者表](https://github.com/langgenius/dify/graphs/contributors)中的一员。

## 社区渠道

遇到困难了吗？有任何问题吗? 加入 [Discord Community Server](https://discord.gg/AhzKf7dNgk)，我们将为您提供帮助。

### 多语言支持

需要参与贡献翻译内容，请参阅[前端多语言翻译 README](web/i18n/README_CN.md)。
