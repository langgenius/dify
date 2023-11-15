![](./images/describe-en.png)
<p align="center">
  <a href="./README.md">English</a> |
  <a href="./README_CN.md">简体中文</a> |
  <a href="./README_JA.md">日本語</a> |
  <a href="./README_ES.md">Español</a>
</p>

#### [Website](https://dify.ai) • [Docs](https://docs.dify.ai) • [Deployment Docs](https://docs.dify.ai/getting-started/install-self-hosted) •  [FAQ](https://docs.dify.ai/getting-started/faq) • [Twitter](https://twitter.com/dify_ai) • [Discord](https://discord.gg/FngNHpbcY7)

**Dify** is an LLM application development platform that has already seen over 100,000 applications built on Dify.AI. It integrates the concepts of Backend as a Service and LLMOps, covering the core tech stack required for building generative AI-native applications, including a built-in RAG engine. With Dify, **you can self-deploy capabilities similar to Assistants API and GPTs based on any LLMs.**

https://github.com/langgenius/dify/assets/100913391/f6e658d5-31b3-4c16-a0af-9e191da4d0f6

## Use Cloud Services

Using [Dify.AI Cloud](https://dify.ai) provides all the capabilities of the open-source version, and includes a complimentary 200 GPT trial credits.

## Why Dify

Dify features model neutrality and is a complete, engineered tech stack compared to hardcoded development libraries like LangChain. Unlike OpenAI's Assistants API, Dify allows for full local deployment of services.

| Feature | Dify.AI | Assistants API | LangChain |
|---------|---------|----------------|-----------|
| **Programming Approach** | API-oriented | API-oriented | Python Code-oriented |
| **Ecosystem Strategy** | Open Source | Closed and Commercial | Open Source |
| **RAG Engine** | Supported | Supported | Not Supported |
| **Prompt IDE** | Included | Included | None |
| **Supported LLMs** | Rich Variety | Only GPT | Rich Variety |
| **Local Deployment** | Supported | Not Supported | Not Applicable |

## Features

**1. LLM Support**: Integration with OpenAI's GPT family of models, or the open-source Llama2 family models. In fact, Dify supports mainstream commercial models and open-source models (locally deployed or based on MaaS).

**2. Prompt IDE**: Visual orchestration of applications and services based on LLMs with your team.

**3. RAG Engine**: Includes various RAG capabilities based on full-text indexing or vector database embeddings, allowing direct upload of PDFs, TXTs, and other text formats.

**4. Agents**: A Function Calling based Agent framework that allows users to configure what they see is what they get. Dify includes basic plugin capabilities like Google Search.

**5. Continuous Operations**: Monitor and analyze application logs and performance, continuously improving Prompts, datasets, or models using production data.

## Install the Community Edition

### System Requirements

Before installing Dify, make sure your machine meets the following minimum system requirements:

- CPU >= 2 Core
- RAM >= 4GB

### Quick Start

The easiest way to start the Dify server is to run our [docker-compose.yml](docker/docker-compose.yaml) file. Before running the installation command, make sure that [Docker](https://docs.docker.com/get-docker/) and [Docker Compose](https://docs.docker.com/compose/install/) are installed on your machine:

```bash
cd docker
docker compose up -d
```

After running, you can access the Dify dashboard in your browser at [http://localhost/install](http://localhost/install) and start the initialization installation process.

### Helm Chart

A big thanks to @BorisPolonsky for providing us with a [Helm Chart](https://helm.sh/) version, which allows Dify to be deployed on Kubernetes.
You can go to https://github.com/BorisPolonsky/dify-helm for deployment information.

### Configuration

If you need to customize the configuration, please refer to the comments in our [docker-compose.yml](docker/docker-compose.yaml) file and manually set the environment configuration. After making the changes, please run 'docker-compose up -d' again.


## Star History

[![Star History Chart](https://api.star-history.com/svg?repos=langgenius/dify&type=Date)](https://star-history.com/#langgenius/dify&Date)

## Contributing 

We welcome you to contribute to Dify to help make Dify better. We welcome contributions in various ways, submitting code, issues, new ideas, or sharing the interesting and useful AI applications you have created based on Dify. At the same time, we also welcome you to share Dify at different events, conferences, and social media.

### Submit a Pull Request 

To ensure proper review, all code contributions, including from contributors with direct commit access, must be submitted as PR requests and approved by core developers before merging branches. 
We welcome PRs from everyone! If you're willing to help out, you can learn more about how to contribute code to the project in the [Contribution Guide](CONTRIBUTING.md).  

### Submit issues or ideas  

You can submit your issues or ideas by adding issues to the Dify repository. If you encounter issues, please describe the steps you took to encounter the issue as much as possible so we can better discover it. If you have any new ideas for our product, we also welcome your feedback. Please share your insights as much as possible so we can get more feedback and further discussion in the community.  

### Share your applications

We encourage all community members to share their AI applications built on Dify, which can be applied to different scenarios or different users. This will provide powerful inspiration for people who want to create AI capabilities! You can share your experience by [submitting an issue in the Dify-user-case repository](https://github.com/langgenius/dify-user-case/issues).  

### Share Dify with others

We encourage community contributors to actively demonstrate different aspects of using Dify. You can talk or share any feature of using Dify at  meetups and conferences, blogs or social media. We believe your unique sharing will be of great help to others!  Mention @Dify.AI on Twitter and/or communicate on [Discord](https://discord.gg/FngNHpbcY7) so we can give pointers and tips and help you spread the word by promoting your content on the different Dify communication channels.

### Help others 
You can also help people in need of help on Discord, GitHub issues or other social platforms, guide others to solve problems encountered during use and share usage experiences. This is also a great contribution! If you want to become a maintainer of the Dify community, please contact the official team via [Discord](https://discord.gg/FngNHpbcY7) or email us at support@dify.ai. 


## Contact Us

If you have any questions, suggestions, or partnership inquiries, feel free to contact us through the following channels:

- Submit an Issue or PR on our GitHub Repo
- Join the discussion in our [Discord](https://discord.gg/FngNHpbcY7) Community
- Send an email to hello@dify.ai

We're eager to assist you and together create more fun and useful AI applications!

## Security

To protect your privacy, please avoid posting security issues on GitHub. Instead, send your questions to security@dify.ai and we will provide you with a more detailed answer.


## License

This repository is available under the [Dify Open Source License](LICENSE), which is essentially Apache 2.0 with a few additional restrictions.
