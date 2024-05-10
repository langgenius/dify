![cover-v5-optimized](https://github.com/langgenius/dify/assets/13230914/f9e19af5-61ba-4119-b926-d10c4c06ebab)

<p align="center">
  <a href="https://cloud.dify.ai">Dify Cloud</a> ·
  <a href="https://docs.dify.ai/getting-started/install-self-hosted">セルフホスト</a> ·
  <a href="https://docs.dify.ai">ドキュメント</a> ·
  <a href="https://cal.com/guchenhe/dify-demo">デモのスケジュール</a>
</p>

<p align="center">
    <a href="https://dify.ai" target="_blank">
        <img alt="Static Badge" src="https://img.shields.io/badge/Product-F04438"></a>
    <a href="https://dify.ai/pricing" target="_blank">
        <img alt="Static Badge" src="https://img.shields.io/badge/free-pricing?logo=free&color=%20%23155EEF&label=pricing&labelColor=%20%23528bff"></a>
    <a href="https://discord.gg/FngNHpbcY7" target="_blank">
        <img src="https://img.shields.io/discord/1082486657678311454?logo=discord&labelColor=%20%235462eb&logoColor=%20%23f5f5f5&color=%20%235462eb"
            alt="Discordでチャット"></a>
    <a href="https://twitter.com/intent/follow?screen_name=dify_ai" target="_blank">
        <img src="https://img.shields.io/twitter/follow/dify_ai?logo=X&color=%20%23f5f5f5"
            alt="Twitterでフォロー"></a>
    <a href="https://hub.docker.com/u/langgenius" target="_blank">
        <img alt="Docker Pulls" src="https://img.shields.io/docker/pulls/langgenius/dify-web?labelColor=%20%23FDB062&color=%20%23f79009"></a>
    <a href="https://github.com/langgenius/dify/graphs/commit-activity" target="_blank">
        <img alt="先月のコミット" src="https://img.shields.io/github/commit-activity/m/langgenius/dify?labelColor=%20%2332b583&color=%20%2312b76a"></a>
    <a href="https://github.com/langgenius/dify/" target="_blank">
        <img alt="クローズされた問題" src="https://img.shields.io/github/issues-search?query=repo%3Alanggenius%2Fdify%20is%3Aclosed&label=issues%20closed&labelColor=%20%237d89b0&color=%20%235d6b98"></a>
    <a href="https://github.com/langgenius/dify/discussions/" target="_blank">
        <img alt="ディスカッション投稿" src="https://img.shields.io/github/discussions/langgenius/dify?labelColor=%20%239b8afb&color=%20%237a5af8"></a>
</p>

<p align="center">
  <a href="./README.md"><img alt="先月のコミット" src="https://img.shields.io/badge/English-d9d9d9"></a>
  <a href="./README_CN.md"><img alt="先月のコミット" src="https://img.shields.io/badge/简体中文-d9d9d9"></a>
  <a href="./README_JA.md"><img alt="先月のコミット" src="https://img.shields.io/badge/日本語-d9d9d9"></a>
  <a href="./README_ES.md"><img alt="先月のコミット" src="https://img.shields.io/badge/Español-d9d9d9"></a>
  <a href="./README_KL.md"><img alt="先月のコミット" src="https://img.shields.io/badge/Français-d9d9d9"></a>
  <a href="./README_FR.md"><img alt="先月のコミット" src="https://img.shields.io/badge/Klingon-d9d9d9"></a>
</p>

#

<p align="center">
  <a href="https://trendshift.io/repositories/2152" target="_blank"><img src="https://trendshift.io/api/badge/repositories/2152" alt="langgenius%2Fdify | Trendshift" style="width: 250px; height: 55px;" width="250" height="55"/></a>
</p>

DifyはオープンソースのLLMアプリケーション開発プラットフォームです。直感的なインターフェースには、AIワークフロー、RAGパイプライン、エージェント機能、モデル管理、観測機能などが組み合わさっており、プロトタイプから本番までの移行を迅速に行うことができます。以下は、主要機能のリストです：
</br> </br>

**1. ワークフロー**: 
  ビジュアルキャンバス上で強力なAIワークフローを構築してテストし、以下の機能を活用してプロトタイプを超えることができます。


  https://github.com/langgenius/dify/assets/13230914/356df23e-1604-483d-80a6-9517ece318aa



**2. 包括的なモデルサポート**: 
  数百のプロプライエタリ/オープンソースのLLMと、数十の推論プロバイダーおよびセルフホスティングソリューションとのシームレスな統合を提供します。GPT、Mistral、Llama3、およびOpenAI API互換のモデルをカバーします。サポートされているモデルプロバイダーの完全なリストは[こちら](https://docs.dify.ai/getting-started/readme/model-providers)をご覧ください。

![providers-v5](https://github.com/langgenius/dify/assets/13230914/5a17bdbe-097a-4100-8363-40255b70f6e3)


**3. プロンプトIDE**: 
  チャットベースのアプリにテキスト読み上げなどの追加機能を追加するプロンプトを作成し、モデルのパフォーマンスを比較する直感的なインターフェース。

**4. RAGパイプライン**: 
  文書の取り込みから取得までをカバーする幅広いRAG機能で、PDF、PPTなどの一般的なドキュメント形式からのテキスト抽出に対するアウトオブボックスのサポートを提供します。

**5. エージェント機能**: 
  LLM関数呼び出しまたはReActに基づいてエージェントを定義し、エージェント向けの事前構築済みまたはカスタムのツールを追加できます。Difyには、Google検索、DELL·E、Stable Diffusion、WolframAlphaなどのAIエージェント用の50以上の組み込みツールが用意されています。

**6. LLMOps**: 
  アプリケーションログとパフォーマンスを時間の経過とともにモニタリングおよび分析します。本番データと注釈に基づいて、プロンプト、データセット、およびモデルを継続的に改善できます。

**7. Backend-as-a-Service**: 
  Difyのすべての提供には、それに対応するAPIが付属しており、独自のビジネスロジックにDifyをシームレスに統合できます。


## 機能比較
<table style="width: 100%;">
  <tr>
    <th align="center">機能</th>
    <th align="center">Dify.AI</th>
    <th align="center">LangChain</th>
    <th align="center">Flowise</th>
    <th align="center">OpenAI Assistants API</th>
  </tr>
  <tr>
    <td align="center">プログラミングアプローチ</td>
    <td align="center">API + アプリ指向</td>
    <td align="center">Pythonコード</td>
    <td align="center">アプリ指向</td>
    <td align="center">API指向</td>
  </tr>
  <tr>
    <td align="center">サポートされているLLM</td>
    <td align="center">バリエーション豊富</td>
    <td align="center">バリエーション豊富</td>
    <td align="center">バリエーション豊富</td>
    <td align="center">OpenAIのみ</td>
  </tr>
  <tr>
    <td align="center">RAGエンジン</td>
    <td align="center">✅</td>
    <td align="center">✅</td>
    <td align="center">✅</td>
    <td align="center">✅</td>
  </tr>
  <tr>
    <td align="center">エージェント</td>
    <td align="center">✅</td>
    <td align="center">✅</td>
    <td align="center">❌</td>
    <td align="center">✅</td>
  </tr>
  <tr>
    <td align="center">ワークフロー</td>
    <td align="center">✅</td>
    <td align="center">❌</td>
    <td align="center">✅</td>
    <td align="center">❌</td>
  </tr>
  <tr>
    <td align="center">観測性</td>
    <td align="center">✅</td>
    <td align="center">✅</td>
    <td align="center">❌</td>
    <td align="center">❌</td>
  </tr>
  <tr>
    <td align="center">エンタープライズ機能（SSO/アクセス制御）</td>
    <td align="center">✅</td>
    <td align="center">❌</td>
    <td align="center">❌</td>
    <td align="center">❌</td>
  </tr>
  <tr>
    <td align="center">ローカル展開</td>
    <td align="center">✅</td>
    <td align="center">✅</td>
    <td align="center">✅</td>
    <td align="center">❌</td>
  </tr>
</table>

## Difyの使用方法

- **クラウド </br>**
[こちら](https://dify.ai)のDify Cloudサービスを利用して、セットアップ不要で試すことができます。サンドボックスプランには、200回の無料のGPT-4呼び出しが含まれています。

- **Dify Community Editionのセルフホスティング</br>**
この[スターターガイド](#quick-start)を使用して、ローカル環境でDifyを簡単に実行できます。
さらなる参考資料や詳細な手順については、[ドキュメント](https://docs.dify.ai)をご覧ください。

- **エンタープライズ/組織向けのDify</br>**
追加のエンタープライズ向け機能を提供しています。[こちらからミーティングを予約](https://cal.com/guchenhe/30min)したり、[メールを送信](mailto:business@dify.ai?subject=[GitHub]Business%20License%20Inquiry)してエンタープライズのニーズについて相談してください。 </br>
  > AWSを使用しているスタートアップや中小企業の場合は、[AWS Marketplace](https://aws.amazon.com/marketplace/pp/prodview-t22mebxzwjhu6)のDify Premiumをチェックして、ワンクリックで独自のAWS VPCにデプロイできます。カスタムロゴとブランディングでアプリを作成するオプションを備えた手頃な価格のAMIオファリングです。


## 最新の情報を入手

GitHub上でDifyにスターを付けることで、Difyに関する新しいニュースを受け取れます。

![star-us](https://github.com/langgenius/dify/assets/13230914/b823edc1-6388-4e25-ad45-2f6b187adbb4)



## クイックスタート
> Difyをインストールする前に、お使いのマシンが以下の最小システム要件を満たしていることを確認してください：
> 
>- CPU >= 2コア
>- RAM >= 4GB

</br>

Difyサーバーを起動する最も簡単な方法は、[docker-compose.yml](docker/docker-compose.yaml)ファイルを実行することです。インストールコマンドを実行する前に、マシンに[Docker](https://docs.docker.com/get-docker/)と[Docker Compose](https://docs.docker.com/compose/install/)がインストールされていることを確認してください。

```bash
cd docker
docker compose up -d
```

実行後、ブラウザで[http://localhost/install](http://localhost/install)にアクセスし、初期化プロセスを開始できます。

> Difyに貢献したり、追加の開発を行う場合は、[ソースコードからのデプロイガイド](https://docs.dify.ai/getting-started/install-self-hosted/local-source-code)を参照してください。

## 次のステップ

環境設定をカスタマイズする場合は、[docker-compose.yml](docker/docker-compose.yaml)ファイル内のコメントを参照して、環境設定を手動で設定してください。変更を加えた後は、再び `docker-compose up -d` を実行してください。環境変数の完全なリストは[こちら](https://docs.dify.ai/getting-started/install-self-hosted/environments)をご覧ください。

高可用性のセットアップを構成する場合は、コミュニティによって提供されている[Helm Charts](https://helm.sh/)があり、これによりKubernetes上にDifyを展開できます。

- [Helm Chart by @LeoQuote](https://github.com/douban/charts/tree/master/charts/dify)
- [Helm Chart by @BorisPolonsky](https://github.com/BorisPolonsky/dify-helm)


## 貢献

コードに貢献したい方は、[Contribution Guide](https://github.com/langgenius/dify/blob/main/CONTRIBUTING.md)を参照してください。
同時に、DifyをSNSやイベント、カンファレンスで共有してサポートしていただけると幸いです。


> Difyを英語または中国語以外の言語に翻訳してくれる貢献者を募集しています。興味がある場合は、詳細については[i18n README](https://github.com/langgenius/dify/blob/main/web/i18n/README.md)を参照してください。また、[Discordコミュニティサーバー](https://discord.gg/8Tpq4AcN9c)の`global-users`チャンネルにコメントを残してください。

**貢献者**

<a href="https://github.com/langgenius/dify/graphs/contributors">
  <img src="https://contrib.rocks/image?repo=langgenius/dify" />
</a>

## コミュニティ & お問い合わせ

* [Github Discussion](https://github.com/langgenius/dify/discussions). 主に: フィードバックの共有や質問。
* [GitHub Issues](https://github.com/langgenius/dify/issues). 主に: Dify.AIの使用中に遭遇したバグや機能提案。
* [Email](mailto:support@dify.ai?subject=[GitHub]Questions%20About%20Dify). 主に: Dify.AIの使用に関する質問。
* [Discord](https://discord.gg/FngNHpbcY7). 主に: アプリケーションの共有やコミュニティとの交流。
* [Twitter](https://twitter.com/dify_ai). 主に: アプリケーションの共有やコミュニティとの交流。

または、直接チームメンバーとミーティングをスケジュール：

<table>
  <tr>
    <th>連絡先</th>
    <th>目的</th>
  </tr>
  <tr>
    <td><a href='https://cal.com

/guchenhe/30min'>ミーティング</a></td>
    <td>無料の30分間のミーティングをスケジュール</td>
  </tr>
  <tr>
    <td><a href='mailto:support@dify.ai?subject=[GitHub]Technical%20Support'>技術サポート</a></td>
    <td>技術的な問題やサポートに関する質問</td>
  </tr>
  <tr>
    <td><a href='mailto:business@dify.ai?subject=[GitHub]Business%20License%20Inquiry'>営業担当</a></td>
    <td>法人ライセンスに関するお問い合わせ</td>
  </tr>
</table>


## ライセンス

このリポジトリは、Dify Open Source License にいくつかの追加制限を加えた[Difyオープンソースライセンス](LICENSE)の下で利用可能です。
