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

**Dify** Hoch LLM qorwI' pIqoDvam pagh laHta' je **100,000** pIqoDvamvam Dify.AI De'wI'. Dify leghpu' Backend chu' a Service teH LLMOps vItlhutlh, generative AI-native pIqoD teq wa'vam, vIyoD Built-in RAG engine. Dify, **'ej chenmoHmoH Hoch 'oHna' Assistant API 'ej GPTmey HoStaHbogh LLMmey.**

![](./images/demo.png)

## ngIl QaQ

[Dify.AI ngIl](https://dify.ai) pIm neHlaH 'ej ghaH. cha'logh wa' DIvI' 200 GPT trial credits.

## Dify WovmoH

Dify Daq rIn neutrality 'ej Hoch, LangChain tInHar HubwI'. maH Daqbe'law' Qawqar, OpenAI's Assistant API Daq local neH deployment.

| Qo'logh | Dify.AI | Assistants API | LangChain |
|---------|---------|----------------|-----------|
| **qet QaS** | API-oriented | API-oriented | Python Code-oriented |
| **Ecosystem Strategy** | Open Source | Closed and Commercial | Open Source |
| **RAG Engine** | Ha'qu' | Ha'qu' | ghoS Ha'qu' |
| **Prompt IDE** | jaH Include | jaH Include | qeylIS qaq |
| **qet LLMmey** | bo'Degh Hoch | GPTmey tIn | bo'Degh Hoch |
| **local deployment** | Ha'qu' | tInHa'qu' | tInHa'qu' ghogh |

## ruch

![](./images/models.png)

**1. LLM tIq**: OpenAI's GPT Hur nISmoHvam neH vIngeH, wa' Llama2 Hur nISmoHvam. Heghlu'lu'pu' Dify mIw 'oH choH qay'be'.Daq commercial Hurmey 'ej Open Source Hurmey (maqtaHvIS pagh locally neH neH deployment HoSvam).

**2. Prompt IDE**: cha'logh wa' LLMmey Hoch janlu'pu' 'ej lughpu' choH qay'be'.

**3. RAG Engine**: RAG vaD tIqpu' lo'taH indexing qor neH vector database wa' embeddings wIj, PDFs, TXTs, 'ej ghojmoHmoH HIq qorlIj je upload.

**4. AI Agent**: Function Calling 'ej ReAct Daq Hurmey, Agent inference framework Hoch users customize tools, vaj 'oH QaQ. Dify Hoch loS ghaH 'ej wa'vatlh built-in tool calling capabilities, Google Search, DELL·E, Stable Diffusion, WolframAlpha, 'ej.

**5. QaS muDHa'wI': cha'logh wa' pIq mI' logs 'ej quv yIn, vItlhutlh tIq 'e'wIj lo'taHmoHmoH Prompts, vItlhutlh, Hurmey ghaH production data jatlh.

## Do'wI' qabmey lo'taH

**maHvaD jatlhchugh, GitHub Daq Hoch chu' ghompu'vam tIqel yInob!**

![star-us](https://github.com/langgenius/dify/assets/100913391/95f37259-7370-4456-a9f0-0bc01ef8642f)

- [Website](https://dify.ai)
- [Docs](https://docs.dify.ai)
- [lo'taHmoH Docs](https://docs.dify.ai/getting-started/install-self-hosted)
- [FAQ](https://docs.dify.ai/getting-started/faq) 

## Community Edition tu' yo'

### System Qab

Dify yo' yo' qaqmeH SuS chenmoH 'oH qech!

- CPU >= 2 Cores
- RAM >= 4GB

### Quick Start

Dify server luHoHtaHlu' vIngeH lo'laHbe'chugh vIyoD [docker-compose.yml](docker/docker-compose.yaml) QorwI'ghach. toH yItlhutlh chenmoH luH!chugh 'ay' vaj vIneHmeH, 'ej [Docker](https://docs.docker.com/get-docker/) 'ej [Docker Compose](https://docs.docker.com/compose/install/) vaj 'oH 'e' vIneHmeH:

```bash
cd docker
docker compose up -d
```

luHoHtaHmeH HoHtaHvIS, Dify dashboard vIneHmeH vIngeH lI'wI' [http://localhost/install](http://localhost/install) 'ej 'oH initialization 'e' vIneHmeH.

### Helm Chart

@BorisPolonsky Dify wIq tIq ['ay'var (Helm Chart)](https://helm.sh/) version Hur yIn chu' Dify luHoHchu'. Heghlu'lu' vIneHmeH [https://github.com/BorisPolonsky/dify-helm](https://github.com/BorisPolonsky/dify-helm) 'ej vaj QaS deployment information.

### veS config

chenmoHDI' config lo'taH ghaH, vItlhutlh HIq wIgharghbe'lu'pu'. toH lo'taHvIS pagh vay' vIneHmeH, 'ej `docker-compose up -d` wa'DIch. tIqmoHmeH list full wa' lo'taHvo'lu'pu' ghaH [docs](https://docs.dify.ai/getting-started/install-self-hosted/environments).

## tIng qem

[![tIng qem Hur Chart](https://api.star-history.com/svg?repos=langgenius/dify&type=Date)](https://star-history.com/#langgenius/dify&Date)

## choHmoH 'ej vItlhutlh

Dify choHmoH je mIw Dify puqloD, Dify ghaHta'bogh vItlhutlh, HurDI' code, ghItlh, ghItlh qo'lu'pu'pu' qej. tIqmeH, Hurmey je, Dify Hur tIqDI' woDDaj, DuD QangmeH 'ej HInobDaq vItlhutlh HImej Dify'e'.

- [GitHub vItlhutlh](https://github.com/langgenius/dify/issues). Hurmey: bugs 'ej errors Dify.AI tIqmeH. yImej [Contribution Guide](CONTRIBUTING.md).
- [Email QaH](mailto:hello@dify.ai?subject=[GitHub]Questions%20About%20Dify). Hurmey: questions vItlhutlh Dify.AI chaw'.
- [Discord](https://discord.gg/FngNHpbcY7). Hurmey: jIpuv 'ej jImej mIw Dify vItlhutlh.
- [Twitter](https://twitter.com/dify_ai). Hurmey: jIpuv 'ej jImej mIw Dify vItlhutlh.
- [Business License](mailto:business@dify.ai?subject=[GitHub]Business%20License%20Inquiry). Hurmey: qurgh vItlhutlh Hurmey Dify.AI tIqbe'law'.

## bIQDaqmey bom

taghlI' vIngeH'a'? pong security 'oH posting GitHub. yItlhutlh, toH security@dify.ai 'ej vIngeH'a'.

## License

ghItlh puqloD chenmoH [Dify vItlhutlh Hur](LICENSE), ghaH nIvbogh Apache 2.0.

