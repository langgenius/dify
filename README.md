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
   <a href="https://aws.amazon.com/marketplace/pp/prodview-t22mebxzwjhu6" target="_blank">
   📌 Check out Dify Premium on AWS and deploy it to your own AWS VPC with one-click.
  </a>
</p>

**Dify** is an LLM application development platform that has helped built over **100,000** applications. It integrates BaaS and LLMOps, covering the essential tech stack for building generative AI-native applications, including a built-in RAG engine. Dify allows you to **deploy your own version of Assistants API and GPTs, based on any LLMs.**

![](./images/demo.png)



## Using our Cloud Services

You can try out [Dify.AI Cloud](https://dify.ai) now. It provides all the capabilities of the self-deployed version, and includes 200 free requests to OpenAI GPT-3.5.

### Looking to purchase via AWS?
Check out [Dify Premium on AWS](https://aws.amazon.com/marketplace/pp/prodview-t22mebxzwjhu6) and deploy it to your own AWS VPC with one-click. 

## Dify vs. LangChain vs. Assistants API

| Feature | Dify.AI | Assistants API | LangChain |
|---------|---------|----------------|-----------|
| **Programming Approach** | API-oriented | API-oriented | Python Code-oriented |
| **Ecosystem Strategy** | Open Source | Close Source | Open Source |
| **RAG Engine** | Supported | Supported | Not Supported |
| **Prompt IDE** | Included | Included | None |
| **Supported LLMs** | Rich Variety | OpenAI-only | Rich Variety |
| **Local Deployment** | Supported | Not Supported | Not Applicable |



## Features

![](./images/models.png)

**1. LLM Support**: Integration with OpenAI's GPT family of models, or the open-source Llama2 family models. In fact, Dify supports mainstream commercial models and open-source models (locally deployed or based on MaaS).

**2. Prompt IDE**: Visual orchestration of applications and services based on LLMs with your team.

**3. RAG Engine**: Includes various RAG capabilities based on full-text indexing or vector database embeddings, allowing direct upload of PDFs, TXTs, and other text formats.

**4. AI Agent**: Based on Function Calling and ReAct, the Agent inference framework allows users to customize tools, what you see is what you get. Dify provides more than a dozen built-in tool calling capabilities, such as Google Search, DELL·E, Stable Diffusion, WolframAlpha, etc.


**5. Continuous Operations**: Monitor and analyze application logs and performance, continuously improving Prompts, datasets, or models using production data.

## Before You Start

**Star us on GitHub, and be instantly notified for new releases!**

![star-us](https://github.com/langgenius/dify/assets/100913391/95f37259-7370-4456-a9f0-0bc01ef8642f)

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

Big thanks to @BorisPolonsky for providing us with a [Helm Chart](https://helm.sh/) version, which allows Dify to be deployed on Kubernetes.
You can go to https://github.com/BorisPolonsky/dify-helm for deployment information.

### Configuration

If you need to customize the configuration, please refer to the comments in our [docker-compose.yml](docker/docker-compose.yaml) file and manually set the environment configuration. After making the changes, please run `docker-compose up -d` again. You can see the full list of environment variables in our [docs](https://docs.dify.ai/getting-started/install-self-hosted/environments).


## Star History

[![Star History Chart](https://api.star-history.com/svg?repos=langgenius/dify&type=Date)](https://star-history.com/#langgenius/dify&Date)

## Contributing

For those who'd like to contribute code, see our [Contribution Guide](https://github.com/langgenius/dify/blob/main/CONTRIBUTING.md). 

At the same time, please consider supporting Dify by sharing it on social media and at events and conferences.

### Contributors

<a href="https://github.com/langgenius/dify/graphs/contributors">
  <img src="https://contrib.rocks/image?repo=langgenius/dify" />
</a>

### Translations

We are looking for contributors to help with translating Dify to languages other than Mandarin or English. If you are interested in helping, please see the [i18n README](https://github.com/langgenius/dify/blob/main/web/i18n/README_EN.md) for more information, and leave us a comment in the `global-users` channel of our [Discord Community Server](https://discord.gg/AhzKf7dNgk).

## Community & Support

* [Canny](https://feedback.dify.ai/). Best for: sharing feedback and checking out our feature roadmap.
* [GitHub Issues](https://github.com/langgenius/dify/issues). Best for: bugs you encounter using Dify.AI, and feature proposals. See our [Contribution Guide](https://github.com/langgenius/dify/blob/main/CONTRIBUTING.md).
* [Email Support](mailto:hello@dify.ai?subject=[GitHub]Questions%20About%20Dify). Best for: questions you have about using Dify.AI.
* [Discord](https://discord.gg/FngNHpbcY7). Best for: sharing your applications and hanging out with the community.
* [Twitter](https://twitter.com/dify_ai). Best for: sharing your applications and hanging out with the community.
* [Business Contact](mailto:business@dify.ai?subject=[GitHub]Business%20License%20Inquiry). Best for: business inquiries of licensing Dify.AI for commercial use.

### Direct Meetings

**Help us make Dify better. Reach out directly to us**.

|                       Point of Contact                       |                           Purpose                            |
| :----------------------------------------------------------: | :----------------------------------------------------------: |
| <a href='https://cal.com/guchenhe/15min' target='_blank'><img src='https://i.postimg.cc/fWBqSmjP/Git-Hub-README-Button-3x.png' border='0' alt='Git-Hub-README-Button-3x' height="60" width="214"/></a> | Product design feedback, user experience discussions, feature planning and roadmaps. |
| <a href='https://cal.com/pinkbanana' target='_blank'><img src='https://i.postimg.cc/LsRTh87D/Git-Hub-README-Button-2x.png' border='0' alt='Git-Hub-README-Button-2x' height="60" width="225"/></a> |        Technical support, issues, or feature requests        |

## Security Disclosure

To protect your privacy, please avoid posting security issues on GitHub. Instead, send your questions to security@dify.ai and we will provide you with a more detailed answer.

## License

This repository is available under the [Dify Open Source License](LICENSE), which is essentially Apache 2.0 with a few additional restrictions.
