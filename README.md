[![](./images/describe.png)](https://dify.ai)
<p align="center">
  <a href="./README.md">English</a> |
  <a href="./README_CN.md">简体中文</a> |
  <a href="./README_JA.md">日本語</a> |
  <a href="./README_ES.md">Español</a> |
  <a href="./README_KL.md">Klingon</a>
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

**Dify** is an LLM application development platform that has already seen over **100,000** applications built on Dify.AI. It integrates the concepts of Backend as a Service and LLMOps, covering the core tech stack required for building generative AI-native applications, including a built-in RAG engine. With Dify, **you can self-deploy capabilities similar to Assistants API and GPTs based on any LLMs.**

![](./images/demo.png)

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

![](./images/models.png)

**1. LLM Support**: Integration with OpenAI's GPT family of models, or the open-source Llama2 family models. In fact, Dify supports mainstream commercial models and open-source models (locally deployed or based on MaaS).

**2. Prompt IDE**: Visual orchestration of applications and services based on LLMs with your team.

**3. RAG Engine**: Includes various RAG capabilities based on full-text indexing or vector database embeddings, allowing direct upload of PDFs, TXTs, and other text formats.

**4. Agents**: A Function Calling based Agent framework that allows users to configure what they see is what they get. Dify includes basic plugin capabilities like Google Search.

**5. Continuous Operations**: Monitor and analyze application logs and performance, continuously improving Prompts, datasets, or models using production data.

## Before You Start

- [Website](https://dify.ai)
- [Docs](https://docs.dify.ai)
- [Deployment Docs](https://docs.dify.ai/getting-started/install-self-hosted)
- [FAQ](https://docs.dify.ai/getting-started/faq) 


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

If you need to customize the configuration, please refer to the comments in our [docker-compose.yml](docker/docker-compose.yaml) file and manually set the environment configuration. After making the changes, please run `docker-compose up -d` again. You can see the full list of environment variables in our [docs](https://docs.dify.ai/getting-started/install-self-hosted/environments).


## Star History

[![Star History Chart](https://api.star-history.com/svg?repos=langgenius/dify&type=Date)](https://star-history.com/#langgenius/dify&Date)


## Community & Support

We welcome you to contribute to Dify to help make Dify better in various ways, submitting code, issues, new ideas, or sharing the interesting and useful AI applications you have created based on Dify. At the same time, we also welcome you to share Dify at different events, conferences, and social media.

- [GitHub Issues](https://github.com/langgenius/dify/issues). Best for: bugs and errors you encounter using Dify.AI, see the [Contribution Guide](CONTRIBUTING.md).
- [Email Support](mailto:hello@dify.ai?subject=[GitHub]Questions%20About%20Dify). Best for: questions you have about using Dify.AI.
- [Discord](https://discord.gg/FngNHpbcY7). Best for: sharing your applications and hanging out with the community.
- [Twitter](https://twitter.com/dify_ai). Best for: sharing your applications and hanging out with the community.
- [Business License](mailto:business@dify.ai?subject=[GitHub]Business%20License%20Inquiry). Best for: business inquiries of licensing Dify.AI for commercial use.

## Security Disclosure

To protect your privacy, please avoid posting security issues on GitHub. Instead, send your questions to security@dify.ai and we will provide you with a more detailed answer.

## License

This repository is available under the [Dify Open Source License](LICENSE), which is essentially Apache 2.0 with a few additional restrictions.
