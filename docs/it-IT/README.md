![cover-v5-optimized](../../images/GitHub_README_if.png)

<p align="center">
  📌 <a href="https://dify.ai/blog/introducing-dify-workflow-file-upload-a-demo-on-ai-podcast">Introduzione a Dify Workflow File Upload: ricreando il podcast di Google NotebookLM</a>
</p>

<p align="center">
  <a href="https://cloud.dify.ai">Dify Cloud</a> ·
  <a href="https://docs.dify.ai/getting-started/install-self-hosted">Self-Hosted</a> ·
  <a href="https://docs.dify.ai">Documentazione</a> ·
  <a href="https://dify.ai/pricing">Panoramica dei prodotti Dify</a>
</p>

<p align="center">
    <a href="https://dify.ai" target="_blank">
        <img alt="Static Badge" src="https://img.shields.io/badge/Product-F04438"></a>
    <a href="https://dify.ai/pricing" target="_blank">
        <img alt="Static Badge" src="https://img.shields.io/badge/free-pricing?logo=free&color=%20%23155EEF&label=pricing&labelColor=%20%23528bff"></a>
    <a href="https://discord.gg/FngNHpbcY7" target="_blank">
        <img src="https://img.shields.io/discord/1082486657678311454?logo=discord&labelColor=%20%235462eb&logoColor=%20%23f5f5f5&color=%20%235462eb"
            alt="chat on Discord"></a>
    <a href="https://reddit.com/r/difyai" target="_blank">  
        <img src="https://img.shields.io/reddit/subreddit-subscribers/difyai?style=plastic&logo=reddit&label=r%2Fdifyai&labelColor=white"
            alt="join Reddit"></a>
    <a href="https://twitter.com/intent/follow?screen_name=dify_ai" target="_blank">
        <img src="https://img.shields.io/twitter/follow/dify_ai?logo=X&color=%20%23f5f5f5"
            alt="follow on X(Twitter)"></a>
    <a href="https://www.linkedin.com/company/langgenius/" target="_blank">
        <img src="https://custom-icon-badges.demolab.com/badge/LinkedIn-0A66C2?logo=linkedin-white&logoColor=fff"
            alt="follow on LinkedIn"></a>
    <a href="https://hub.docker.com/u/langgenius" target="_blank">
        <img alt="Docker Pulls" src="https://img.shields.io/docker/pulls/langgenius/dify-web?labelColor=%20%23FDB062&color=%20%23f79009"></a>
    <a href="https://github.com/langgenius/dify/graphs/commit-activity" target="_blank">
        <img alt="Commits last month" src="https://img.shields.io/github/commit-activity/m/langgenius/dify?labelColor=%20%2332b583&color=%20%2312b76a"></a>
    <a href="https://github.com/langgenius/dify/" target="_blank">
        <img alt="Issues closed" src="https://img.shields.io/github/issues-search?query=repo%3Alanggenius%2Fdify%20is%3Aclosed&label=issues%20closed&labelColor=%20%237d89b0&color=%20%235d6b98"></a>
    <a href="https://github.com/langgenius/dify/discussions/" target="_blank">
        <img alt="Discussion posts" src="https://img.shields.io/github/discussions/langgenius/dify?labelColor=%20%239b8afb&color=%20%237a5af8"></a>
</p>

<p align="center">
  <a href="../../README.md"><img alt="README in English" src="https://img.shields.io/badge/English-d9d9d9"></a>
  <a href="../zh-TW/README.md"><img alt="繁體中文文件" src="https://img.shields.io/badge/繁體中文-d9d9d9"></a>
  <a href="../zh-CN/README.md"><img alt="简体中文文件" src="https://img.shields.io/badge/简体中文-d9d9d9"></a>
  <a href="../ja-JP/README.md"><img alt="日本語のREADME" src="https://img.shields.io/badge/日本語-d9d9d9"></a>
  <a href="../es-ES/README.md"><img alt="README en Español" src="https://img.shields.io/badge/Español-d9d9d9"></a>
  <a href="../fr-FR/README.md"><img alt="README en Français" src="https://img.shields.io/badge/Français-d9d9d9"></a>
  <a href="../tlh/README.md"><img alt="README tlhIngan Hol" src="https://img.shields.io/badge/Klingon-d9d9d9"></a>
  <a href="../ko-KR/README.md"><img alt="README in Korean" src="https://img.shields.io/badge/한국어-d9d9d9"></a>
  <a href="../ar-SA/README.md"><img alt="README بالعربية" src="https://img.shields.io/badge/العربية-d9d9d9"></a>
  <a href="../tr-TR/README.md"><img alt="Türkçe README" src="https://img.shields.io/badge/Türkçe-d9d9d9"></a>
  <a href="../vi-VN/README.md"><img alt="README Tiếng Việt" src="https://img.shields.io/badge/Ti%E1%BA%BFng%20Vi%E1%BB%87t-d9d9d9"></a>
  <a href="../de-DE/README.md"><img alt="README in Deutsch" src="https://img.shields.io/badge/German-d9d9d9"></a>
  <a href="../it-IT/README.md"><img alt="README in Italiano" src="https://img.shields.io/badge/Italiano-d9d9d9"></a>
  <a href="../bn-BD/README.md"><img alt="README in বাংলা" src="https://img.shields.io/badge/বাংলা-d9d9d9"></a>
</p>

Dify è una piattaforma open-source per lo sviluppo di applicazioni LLM. La sua interfaccia intuitiva combina flussi di lavoro AI basati su agenti, pipeline RAG, funzionalità di agenti, gestione dei modelli, funzionalità di monitoraggio e altro ancora, permettendovi di passare rapidamente da un prototipo alla produzione.

## Avvio Rapido

> Prima di installare Dify, assicuratevi che il vostro sistema soddisfi i seguenti requisiti minimi:
>
> - CPU >= 2 Core
> - RAM >= 4 GiB

<br/>

Il modo più semplice per avviare il server Dify è tramite [docker compose](../../docker/docker-compose.yaml). Prima di eseguire Dify con i seguenti comandi, assicuratevi che [Docker](https://docs.docker.com/get-docker/) e [Docker Compose](https://docs.docker.com/compose/install/) siano installati sul vostro sistema:

```bash
cd dify
cd docker
cp .env.example .env
docker compose up -d
```

Dopo aver avviato il server, potete accedere al dashboard di Dify tramite il vostro browser all'indirizzo [http://localhost/install](http://localhost/install) e avviare il processo di inizializzazione.

#### Richiedere Aiuto

Consultate le nostre [FAQ](https://docs.dify.ai/getting-started/install-self-hosted/faqs) se riscontrate problemi durante la configurazione di Dify. Contattateci [tramite la community](#community--contatti) se continuano a verificarsi difficoltà.

> Se desiderate contribuire a Dify o effettuare ulteriori sviluppi, consultate la nostra [guida al deployment dal codice sorgente](https://docs.dify.ai/getting-started/install-self-hosted/local-source-code).

## Caratteristiche Principali

**1. Workflow**:
Create e testate potenti flussi di lavoro AI su un'interfaccia visuale, utilizzando tutte le funzionalità seguenti e oltre.

**2. Supporto Completo dei Modelli**:
Integrazione perfetta con centinaia di LLM proprietari e open-source di decine di provider di inferenza e soluzioni self-hosted, che coprono GPT, Mistral, Llama3 e tutti i modelli compatibili con l'API OpenAI. L'elenco completo dei provider di modelli supportati è disponibile [qui](https://docs.dify.ai/getting-started/readme/model-providers).

![providers-v5](https://github.com/langgenius/dify/assets/13230914/5a17bdbe-097a-4100-8363-40255b70f6e3)

**3. Prompt IDE**:
Interfaccia intuitiva per creare prompt, confrontare le prestazioni dei modelli e aggiungere funzionalità aggiuntive come text-to-speech in un'applicazione basata su chat.

**4. Pipeline RAG**:
Funzionalità RAG complete che coprono tutto, dall'acquisizione dei documenti alla loro interrogazione, con supporto pronto all'uso per l'estrazione di testo da PDF, PPT e altri formati di documenti comuni.

**5. Capacità degli Agenti**:
Potete definire agenti basati su LLM Function Calling o ReAct e aggiungere strumenti predefiniti o personalizzati per l'agente. Dify fornisce oltre 50 strumenti integrati per gli agenti AI, come Google Search, DALL·E, Stable Diffusion e WolframAlpha.

**6. LLMOps**:
Monitorate e analizzate i log delle applicazioni e le prestazioni nel tempo. Potete migliorare continuamente prompt, dataset e modelli basandovi sui dati di produzione e sulle annotazioni.

**7. Backend-as-a-Service**:
Tutte le offerte di Dify sono dotate di API corrispondenti, permettendovi di integrare facilmente Dify nella vostra logica di business.

## Utilizzo di Dify

- **Cloud <br/>**
  Ospitiamo un servizio [Dify Cloud](https://dify.ai) che chiunque può provare senza configurazione. Offre tutte le funzionalità della versione self-hosted e include 200 chiamate GPT-4 gratuite nel piano sandbox.

- **Dify Community Edition Self-Hosted<br/>**
  Avviate rapidamente Dify nel vostro ambiente con questa [guida di avvio rapido](#avvio-rapido). Utilizzate la nostra [documentazione](https://docs.dify.ai) per ulteriori informazioni e istruzioni dettagliate.

- **Dify per Aziende / Organizzazioni<br/>**
  Offriamo funzionalità aggiuntive specifiche per le aziende. [Potete comunicarci le vostre domande tramite questo chatbot](https://udify.app/chat/22L1zSxg6yW1cWQg) o [inviateci un'email](mailto:business@dify.ai?subject=%5BGitHub%5DBusiness%20License%20Inquiry) per discutere le vostre esigenze aziendali. <br/>

  > Per startup e piccole imprese che utilizzano AWS, date un'occhiata a [Dify Premium su AWS Marketplace](https://aws.amazon.com/marketplace/pp/prodview-t22mebxzwjhu6) e distribuitelo con un solo clic nel vostro AWS VPC. Si tratta di un'offerta AMI conveniente con l'opzione di creare app con logo e branding personalizzati.

## Resta Sempre Aggiornato

Mettete una stella a Dify su GitHub e ricevete notifiche immediate sui nuovi rilasci.

![star-us](https://github.com/langgenius/dify/assets/13230914/b823edc1-6388-4e25-ad45-2f6b187adbb4)

## Configurazioni Avanzate

Se dovete personalizzare la configurazione, leggete i commenti nel nostro file [.env.example](../../docker/.env.example) e aggiornate i valori corrispondenti nel vostro file `.env`. Inoltre, potrebbe essere necessario apportare modifiche al file `docker-compose.yaml`, come cambiare le versioni delle immagini, le mappature delle porte o i mount dei volumi, a seconda del vostro ambiente di distribuzione specifico e dei vostri requisiti. Dopo aver apportato le modifiche, riavviate `docker-compose up -d`. L'elenco completo delle variabili d'ambiente disponibili è disponibile [qui](https://docs.dify.ai/getting-started/install-self-hosted/environments).

### Monitoraggio delle Metriche con Grafana

Importate la dashboard in Grafana, utilizzando il database PostgreSQL di Dify come origine dati, per monitorare le metriche a livello di app, tenant, messaggi e altro ancora.

- [Dashboard Grafana di @bowenliang123](https://github.com/bowenliang123/dify-grafana-dashboard)

### Distribuzione con Kubernetes

Se desiderate configurare un'installazione ad alta disponibilità, ci sono [Helm Charts](https://helm.sh/) e file YAML forniti dalla community che consentono di distribuire Dify su Kubernetes.

- [Helm Chart di @LeoQuote](https://github.com/douban/charts/tree/master/charts/dify)
- [Helm Chart di @BorisPolonsky](https://github.com/BorisPolonsky/dify-helm)
- [Helm Chart di @magicsong](https://github.com/magicsong/ai-charts)
- [File YAML di @Winson-030](https://github.com/Winson-030/dify-kubernetes)
- [File YAML di @wyy-holding](https://github.com/wyy-holding/dify-k8s)
- [🚀 NUOVO! File YAML (Supporta Dify v1.6.0) di @Zhoneym](https://github.com/Zhoneym/DifyAI-Kubernetes)

#### Utilizzo di Terraform per la Distribuzione

Distribuite Dify con un solo clic su una piattaforma cloud utilizzando [terraform](https://www.terraform.io/).

##### Azure Global

- [Azure Terraform di @nikawang](https://github.com/nikawang/dify-azure-terraform)

##### Google Cloud

- [Google Cloud Terraform di @sotazum](https://github.com/DeNA/dify-google-cloud-terraform)

#### Utilizzo di AWS CDK per la Distribuzione

Distribuzione di Dify su AWS con [CDK](https://aws.amazon.com/cdk/)

##### AWS

- [AWS CDK di @KevinZhao (basato su EKS)](https://github.com/aws-samples/solution-for-deploying-dify-on-aws)
- [AWS CDK di @tmokmss (basato su ECS)](https://github.com/aws-samples/dify-self-hosted-on-aws)

#### Alibaba Cloud

[Alibaba Cloud Computing Nest](https://computenest.console.aliyun.com/service/instance/create/default?type=user&ServiceName=Dify%E7%A4%BE%E5%8C%BA%E7%89%88)

#### Alibaba Cloud Data Management

Distribuzione con un clic di Dify su Alibaba Cloud con [Alibaba Cloud Data Management](https://www.alibabacloud.com/help/en/dms/dify-in-invitational-preview/)

#### Utilizzo di Azure DevOps Pipeline per la Distribuzione su AKS

Distribuite Dify con un clic in AKS utilizzando [Azure DevOps Pipeline Helm Chart di @LeoZhang](https://github.com/Ruiruiz30/Dify-helm-chart-AKS)

## Contribuire

Se desiderate contribuire con codice, leggete la nostra [Guida ai Contributi](../../CONTRIBUTING.md). Allo stesso tempo, vi chiediamo di supportare Dify condividendolo sui social media e presentandolo a eventi e conferenze.

> Cerchiamo collaboratori che aiutino a tradurre Dify in altre lingue oltre al mandarino o all'inglese. Se siete interessati a collaborare, leggete il [README i18n](https://github.com/langgenius/dify/blob/main/web/i18n-config/README.md) per ulteriori informazioni e lasciate un commento nel canale `global-users` del nostro [server della community Discord](https://discord.gg/8Tpq4AcN9c).

## Community & Contatti

- [GitHub Discussion](https://github.com/langgenius/dify/discussions). Ideale per: condividere feedback e porre domande.
- [GitHub Issues](https://github.com/langgenius/dify/issues). Ideale per: bug che riscontrate durante l'utilizzo di Dify.AI e proposte di funzionalità. Consultate la nostra [Guida ai Contributi](../../CONTRIBUTING.md).
- [Discord](https://discord.gg/FngNHpbcY7). Ideale per: condividere le vostre applicazioni e interagire con la community.
- [X(Twitter)](https://twitter.com/dify_ai). Ideale per: condividere le vostre applicazioni e interagire con la community.

**Collaboratori**

<a href="https://github.com/langgenius/dify/graphs/contributors">
  <img src="https://contrib.rocks/image?repo=langgenius/dify" />
</a>

## Storia delle Stelle

[![Star History Chart](https://api.star-history.com/svg?repos=langgenius/dify&type=Date)](https://star-history.com/#langgenius/dify&Date)

## Divulgazione sulla Sicurezza

Per proteggere la vostra privacy, evitate di pubblicare problemi di sicurezza su GitHub. Inviate invece le vostre domande a security@dify.ai e vi forniremo una risposta più dettagliata.

## Licenza

Questo repository è disponibile sotto la [Dify Open Source License](../../LICENSE), che è essenzialmente Apache 2.0 con alcune restrizioni aggiuntive.
