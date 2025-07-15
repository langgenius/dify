![cover-v5-optimized](./images/GitHub_README_if.png)

<p align="center">
  📌 <a href="https://dify.ai/blog/introducing-dify-workflow-file-upload-a-demo-on-ai-podcast">Einführung in Dify Workflow File Upload: Google NotebookLM Podcast nachbilden</a>
</p>

<p align="center">
  <a href="https://cloud.dify.ai">Dify Cloud</a> ·
  <a href="https://docs.dify.ai/getting-started/install-self-hosted">Selbstgehostetes</a> ·
  <a href="https://docs.dify.ai">Dokumentation</a> ·
  <a href="https://dify.ai/pricing">Überblick über die Dify-Produkte</a>
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
  <a href="./README_DE.md"><img alt="README in Deutsch" src="https://img.shields.io/badge/German-d9d9d9"></a>
  <a href="./README_BN.md"><img alt="README in বাংলা" src="https://img.shields.io/badge/বাংলা-d9d9d9"></a>
</p>

Dify ist eine Open-Source-Plattform zur Entwicklung von LLM-Anwendungen. Ihre intuitive Benutzeroberfläche vereint agentenbasierte KI-Workflows, RAG-Pipelines, Agentenfunktionen, Modellverwaltung, Überwachungsfunktionen und mehr, sodass Sie schnell von einem Prototyp in die Produktion übergehen können.

## Schnellstart
> Bevor Sie Dify installieren, stellen Sie sicher, dass Ihr System die folgenden Mindestanforderungen erfüllt:
> 
>- CPU >= 2 Core
>- RAM >= 4 GiB

</br>

Der einfachste Weg, den Dify-Server zu starten, ist über [docker compose](docker/docker-compose.yaml). Stellen Sie vor dem Ausführen von Dify mit den folgenden Befehlen sicher, dass [Docker](https://docs.docker.com/get-docker/) und [Docker Compose](https://docs.docker.com/compose/install/) auf Ihrem System installiert sind:

```bash
cd dify
cd docker
cp .env.example .env
docker compose up -d
```

Nachdem Sie den Server gestartet haben, können Sie über Ihren Browser auf das Dify Dashboard unter [http://localhost/install](http://localhost/install) zugreifen und den Initialisierungsprozess starten.

#### Hilfe suchen
Bitte beachten Sie unsere [FAQ](https://docs.dify.ai/getting-started/install-self-hosted/faqs), wenn Sie Probleme bei der Einrichtung von Dify haben. Wenden Sie sich an [die Community und uns](#community--contact), falls weiterhin Schwierigkeiten auftreten.

> Wenn Sie zu Dify beitragen oder zusätzliche Entwicklungen durchführen möchten, lesen Sie bitte unseren [Leitfaden zur Bereitstellung aus dem Quellcode](https://docs.dify.ai/getting-started/install-self-hosted/local-source-code).

## Wesentliche Merkmale
**1. Workflow**: 
  Erstellen und testen Sie leistungsstarke KI-Workflows auf einer visuellen Oberfläche, wobei Sie alle der folgenden Funktionen und darüber hinaus nutzen können.

**2. Umfassende Modellunterstützung**: 
  Nahtlose Integration mit Hunderten von proprietären und Open-Source-LLMs von Dutzenden Inferenzanbietern und selbstgehosteten Lösungen, die GPT, Mistral, Llama3 und alle mit der OpenAI API kompatiblen Modelle abdecken. Eine vollständige Liste der unterstützten Modellanbieter finden Sie [hier](https://docs.dify.ai/getting-started/readme/model-providers).


![providers-v5](https://github.com/langgenius/dify/assets/13230914/5a17bdbe-097a-4100-8363-40255b70f6e3)


**3. Prompt IDE**: 
  Intuitive Benutzeroberfläche zum Erstellen von Prompts, zum Vergleichen der Modellleistung und zum Hinzufügen zusätzlicher Funktionen wie Text-to-Speech in einer chatbasierten Anwendung.

**4. RAG Pipeline**: 
  Umfassende RAG-Funktionalitäten, die alles von der Dokumenteneinlesung bis zur -abfrage abdecken, mit sofort einsatzbereiter Unterstützung für die Textextraktion aus PDFs, PPTs und anderen gängigen Dokumentformaten.

**5. Fähigkeiten des Agenten**: 
  Sie können Agenten basierend auf LLM Function Calling oder ReAct definieren und vorgefertigte oder benutzerdefinierte Tools für den Agenten hinzufügen. Dify stellt über 50 integrierte Tools für KI-Agenten bereit, wie zum Beispiel Google Search, DALL·E, Stable Diffusion und WolframAlpha.

**6. LLMOps**: 
  Überwachen und analysieren Sie Anwendungsprotokolle und die Leistung im Laufe der Zeit. Sie können kontinuierlich Prompts, Datensätze und Modelle basierend auf Produktionsdaten und Annotationen verbessern.

**7. Backend-as-a-Service**: 
  Alle Dify-Angebote kommen mit entsprechenden APIs, sodass Sie Dify mühelos in Ihre eigene Geschäftslogik integrieren können.

## Vergleich der Merkmale
<table style="width: 100%;">
  <tr>
    <th align="center">Feature</th>
    <th align="center">Dify.AI</th>
    <th align="center">LangChain</th>
    <th align="center">Flowise</th>
    <th align="center">OpenAI Assistants API</th>
  </tr>
  <tr>
    <td align="center">Programming Approach</td>
    <td align="center">API + App-oriented</td>
    <td align="center">Python Code</td>
    <td align="center">App-oriented</td>
    <td align="center">API-oriented</td>
  </tr>
  <tr>
    <td align="center">Supported LLMs</td>
    <td align="center">Rich Variety</td>
    <td align="center">Rich Variety</td>
    <td align="center">Rich Variety</td>
    <td align="center">OpenAI-only</td>
  </tr>
  <tr>
    <td align="center">RAG Engine</td>
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
    <td align="center">Workflow</td>
    <td align="center">✅</td>
    <td align="center">❌</td>
    <td align="center">✅</td>
    <td align="center">❌</td>
  </tr>
  <tr>
    <td align="center">Observability</td>
    <td align="center">✅</td>
    <td align="center">✅</td>
    <td align="center">❌</td>
    <td align="center">❌</td>
  </tr>
  <tr>
    <td align="center">Enterprise Feature (SSO/Access control)</td>
    <td align="center">✅</td>
    <td align="center">❌</td>
    <td align="center">❌</td>
    <td align="center">❌</td>
  </tr>
  <tr>
    <td align="center">Local Deployment</td>
    <td align="center">✅</td>
    <td align="center">✅</td>
    <td align="center">✅</td>
    <td align="center">❌</td>
  </tr>
</table>

## Dify verwenden

- **Cloud </br>**
Wir hosten einen [Dify Cloud](https://dify.ai)-Service, den jeder ohne Einrichtung ausprobieren kann. Er bietet alle Funktionen der selbstgehosteten Version und beinhaltet 200 kostenlose GPT-4-Aufrufe im Sandbox-Plan.

- **Selbstgehostete Dify Community Edition</br>**
Starten Sie Dify schnell in Ihrer Umgebung mit diesem [Schnellstart-Leitfaden](#quick-start). Nutzen Sie unsere [Dokumentation](https://docs.dify.ai) für weiterführende Informationen und detaillierte Anweisungen.

- **Dify für Unternehmen / Organisationen</br>**
Wir bieten zusätzliche, unternehmensspezifische Funktionen. [Über diesen Chatbot können Sie uns Ihre Fragen mitteilen](https://udify.app/chat/22L1zSxg6yW1cWQg) oder [senden Sie uns eine E-Mail](mailto:business@dify.ai?subject=[GitHub]Business%20License%20Inquiry), um Ihre unternehmerischen Bedürfnisse zu besprechen. </br>
  > Für Startups und kleine Unternehmen, die AWS nutzen, schauen Sie sich [Dify Premium on AWS Marketplace](https://aws.amazon.com/marketplace/pp/prodview-t22mebxzwjhu6) an und stellen Sie es mit nur einem Klick in Ihrer eigenen AWS VPC bereit. Es handelt sich um ein erschwingliches AMI-Angebot mit der Option, Apps mit individuellem Logo und Branding zu erstellen.


## Immer einen Schritt voraus

Star Dify auf GitHub und lassen Sie sich sofort über neue Releases benachrichtigen.

![star-us](https://github.com/langgenius/dify/assets/13230914/b823edc1-6388-4e25-ad45-2f6b187adbb4)


## Erweiterte Einstellungen

Falls Sie die Konfiguration anpassen müssen, lesen Sie bitte die Kommentare in unserer [.env.example](docker/.env.example)-Datei und aktualisieren Sie die entsprechenden Werte in Ihrer `.env`-Datei. Zusätzlich müssen Sie eventuell Anpassungen an der `docker-compose.yaml`-Datei vornehmen, wie zum Beispiel das Ändern von Image-Versionen, Portzuordnungen oder Volumen-Mounts, je nach Ihrer spezifischen Einsatzumgebung und Ihren Anforderungen. Nachdem Sie Änderungen vorgenommen haben, starten Sie `docker-compose up -d` erneut. Eine vollständige Liste der verfügbaren Umgebungsvariablen finden Sie [hier](https://docs.dify.ai/getting-started/install-self-hosted/environments).

Falls Sie eine hochverfügbare Konfiguration einrichten möchten, gibt es von der Community bereitgestellte [Helm Charts](https://helm.sh/) und YAML-Dateien, die es ermöglichen, Dify auf Kubernetes bereitzustellen.

- [Helm Chart by @LeoQuote](https://github.com/douban/charts/tree/master/charts/dify)
- [Helm Chart by @BorisPolonsky](https://github.com/BorisPolonsky/dify-helm)
- [Helm Chart by @magicsong](https://github.com/magicsong/ai-charts)
- [YAML file by @Winson-030](https://github.com/Winson-030/dify-kubernetes)
- [YAML file by @wyy-holding](https://github.com/wyy-holding/dify-k8s)
- [🚀 NEW! YAML files (Supports Dify v1.6.0) by @Zhoneym](https://github.com/Zhoneym/DifyAI-Kubernetes)

#### Terraform für die Bereitstellung verwenden

Stellen Sie Dify mit nur einem Klick mithilfe von [terraform](https://www.terraform.io/) auf einer Cloud-Plattform bereit.

##### Azure Global
- [Azure Terraform by @nikawang](https://github.com/nikawang/dify-azure-terraform)

##### Google Cloud
- [Google Cloud Terraform by @sotazum](https://github.com/DeNA/dify-google-cloud-terraform)

#### Verwendung von AWS CDK für die Bereitstellung

Bereitstellung von Dify auf AWS mit [CDK](https://aws.amazon.com/cdk/)

##### AWS 
- [AWS CDK by @KevinZhao](https://github.com/aws-samples/solution-for-deploying-dify-on-aws)

#### Alibaba Cloud 

[Alibaba Cloud Computing Nest](https://computenest.console.aliyun.com/service/instance/create/default?type=user&ServiceName=Dify%E7%A4%BE%E5%8C%BA%E7%89%88)

#### Alibaba Cloud Data Management

Ein-Klick-Bereitstellung von Dify in der Alibaba Cloud mit [Alibaba Cloud Data Management](https://www.alibabacloud.com/help/en/dms/dify-in-invitational-preview/)


## Contributing

Falls Sie Code beitragen möchten, lesen Sie bitte unseren [Contribution Guide](https://github.com/langgenius/dify/blob/main/CONTRIBUTING.md). Gleichzeitig bitten wir Sie, Dify zu unterstützen, indem Sie es in den sozialen Medien teilen und auf Veranstaltungen und Konferenzen präsentieren.


> Wir suchen Mitwirkende, die dabei helfen, Dify in weitere Sprachen zu übersetzen – außer Mandarin oder Englisch. Wenn Sie Interesse an einer Mitarbeit haben, lesen Sie bitte die [i18n README](https://github.com/langgenius/dify/blob/main/web/i18n/README.md) für weitere Informationen und hinterlassen Sie einen Kommentar im `global-users`-Kanal unseres [Discord Community Servers](https://discord.gg/8Tpq4AcN9c).

## Gemeinschaft & Kontakt

* [GitHub Discussion](https://github.com/langgenius/dify/discussions). Am besten geeignet für: den Austausch von Feedback und das Stellen von Fragen.
* [GitHub Issues](https://github.com/langgenius/dify/issues). Am besten für: Fehler, auf die Sie bei der Verwendung von Dify.AI stoßen, und Funktionsvorschläge. Siehe unseren [Contribution Guide](https://github.com/langgenius/dify/blob/main/CONTRIBUTING.md).
* [Discord](https://discord.gg/FngNHpbcY7).  Am besten geeignet für: den Austausch von Bewerbungen und den Austausch mit der Community.
* [X(Twitter)](https://twitter.com/dify_ai). Am besten geeignet für: den Austausch von Bewerbungen und den Austausch mit der Community.

**Mitwirkende**

<a href="https://github.com/langgenius/dify/graphs/contributors">
  <img src="https://contrib.rocks/image?repo=langgenius/dify" />
</a>

## Star-Geschichte

[![Star History Chart](https://api.star-history.com/svg?repos=langgenius/dify&type=Date)](https://star-history.com/#langgenius/dify&Date)


## Offenlegung der Sicherheit

Um Ihre Privatsphäre zu schützen, vermeiden Sie es bitte, Sicherheitsprobleme auf GitHub zu posten. Schicken Sie Ihre Fragen stattdessen an security@dify.ai und wir werden Ihnen eine ausführlichere Antwort geben.

## Lizenz

Dieses Repository steht unter der [Dify Open Source License](LICENSE), die im Wesentlichen Apache 2.0 mit einigen zusätzlichen Einschränkungen ist.

