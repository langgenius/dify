![cover-v5-optimized](https://github.com/langgenius/dify/assets/13230914/f9e19af5-61ba-4119-b926-d10c4c06ebab)

<p align="center">
  <a href="https://cloud.dify.ai">Dify Cloud</a> ·
  <a href="https://docs.dify.ai/getting-started/install-self-hosted">セルフホスティング</a> ·
  <a href="https://docs.dify.ai">ドキュメント</a> ·
  <a href="https://cal.com/guchenhe/dify-demo">デモの予約</a>
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
  <a href="./README_KR.md"><img alt="先月のコミット" src="https://img.shields.io/badge/한국어-d9d9d9"></a>
</p>

#

<p align="center">
  <a href="https://trendshift.io/repositories/2152" target="_blank"><img src="https://trendshift.io/api/badge/repositories/2152" alt="langgenius%2Fdify | Trendshift" style="width: 250px; height: 55px;" width="250" height="55"/></a>
</p>

DifyはオープンソースのLLMアプリケーション開発プラットフォームです。直感的なインターフェイスには、AIワークフロー、RAGパイプライン、エージェント機能、モデル管理、観測機能などが組み合わさっており、プロトタイプから生産まで迅速に進めることができます。以下の機能が含まれます：
</br> </br>

**1. ワークフロー**: 
  強力なAIワークフローをビジュアルキャンバス上で構築し、テストできます。すべての機能、および以下の機能を使用できます。


  https://github.com/langgenius/dify/assets/13230914/356df23e-1604-483d-80a6-9517ece318aa



**2. 総合的なモデルサポート**: 
  数百ものプロプライエタリ/オープンソースのLLMと、数十もの推論プロバイダーおよびセルフホスティングソリューションとのシームレスな統合を提供します。GPT、Mistral、Llama3、OpenAI APIと互換性のあるすべてのモデルを統合されています。サポートされているモデルプロバイダーの完全なリストは[こちら](https://docs.dify.ai/getting-started/readme/model-providers)をご覧ください。

![providers-v5](https://github.com/langgenius/dify/assets/13230914/5a17bdbe-097a-4100-8363-40255b70f6e3)


**3. プロンプトIDE**: 
  プロンプトの作成、モデルパフォーマンスの比較が行え、チャットベースのアプリに音声合成などの機能も追加できます。

**4. RAGパイプライン**: 
  ドキュメントの取り込みから検索までをカバーする広範なRAG機能ができます。ほかにもPDF、PPT、その他の一般的なドキュメントフォーマットからのテキスト抽出のサーポイントも提供します。

**5. エージェント機能**: 
  LLM Function CallingやReActに基づくエージェントの定義が可能で、AIエージェント用のプリビルトまたはカスタムツールを追加できます。Difyには、Google検索、DELL·E、Stable Diffusion、WolframAlphaなどのAIエージェント用の50以上の組み込みツールが提供します。

**6. LLMOps**: 
  アプリケーションのログやパフォーマンスを監視と分析し、生産のデータと注釈に基づいて、プロンプト、データセット、モデルを継続的に改善できます。

**7. Backend-as-a-Service**: 
  すべての機能はAPIを提供されており、Difyを自分のビジネスロジックに簡単に統合できます。


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
    <td align="center">バラエティ豊か</td>
    <td align="center">バラエティ豊か</td>
    <td align="center">バラエティ豊か</td>
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
[こちら](https://dify.ai)のDify Cloudサービスを利用して、セットアップ不要で試すことができます。サンドボックスプランには、200回のGPT-4呼び出しが無料で含まれています。

- **Dify Community Editionのセルフホスティング</br>**
この[スタートガイド](#quick-start)を使用して、ローカル環境でDifyを簡単に実行できます。
詳しくは[ドキュメント](https://docs.dify.ai)をご覧ください。

- **企業/組織向けのDify</br>**
企業中心の機能を提供しています。[こちらからミーティングを予約](https://cal.com/guchenhe/30min)したり、[メールを送信](mailto:business@dify.ai?subject=[GitHub]Business%20License%20Inquiry)して企業のニーズについて相談してください。 </br>
  > AWSを使用しているスタートアップ企業や中小企業の場合は、[AWS Marketplace](https://aws.amazon.com/marketplace/pp/prodview-t22mebxzwjhu6)のDify Premiumをチェックして、ワンクリックで自分のAWS VPCにデプロイできます。さらに、手頃な価格のAMIオファリングどして、ロゴやブランディングをカスタマイズしてアプリケーションを作成するオプションがあります。


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
cp .env.example .env
docker compose up -d
```

実行後、ブラウザで[http://localhost/install](http://localhost/install)にアクセスし、初期化プロセスを開始できます。

> Difyに貢献したり、追加の開発を行う場合は、[ソースコードからのデプロイガイド](https://docs.dify.ai/getting-started/install-self-hosted/local-source-code)を参照してください。

## 次のステップ

設定をカスタマイズする必要がある場合は、[.env.example](docker/.env.example) ファイルのコメントを参照し、`.env` ファイルの対応する値を更新してください。さらに、デプロイ環境や要件に応じて、`docker-compose.yaml` ファイル自体を調整する必要がある場合があります。たとえば、イメージのバージョン、ポートのマッピング、ボリュームのマウントなどを変更します。変更を加えた後は、`docker-compose up -d` を再実行してください。利用可能な環境変数の全一覧は、[こちら](https://docs.dify.ai/getting-started/install-self-hosted/environments)で確認できます。

高可用性設定を設定する必要がある場合、コミュニティは[Helm Charts](https://helm.sh/)とYAMLファイルにより、DifyをKubernetesにデプロイすることができます。

- [Helm Chart by @LeoQuote](https://github.com/douban/charts/tree/master/charts/dify)
- [Helm Chart by @BorisPolonsky](https://github.com/BorisPolonsky/dify-helm)
- [YAML file by @Winson-030](https://github.com/Winson-030/dify-kubernetes)

#### Terraformを使用したデプロイ

##### Azure Global
[terraform](https://www.terraform.io/) を使用して、AzureにDifyをワンクリックでデプロイします。
- [nikawangのAzure Terraform](https://github.com/nikawang/dify-azure-terraform)


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
* [GitHub Issues](https://github.com/langgenius/dify/issues). 主に: Dify.AIを使用する際に発生するエラーや問題については、[貢献ガイド](CONTRIBUTING_JA.md)を参照してください
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
    <td><a href='https://github.com/langgenius/dify/issues'>技術サポート</a></td>
    <td>技術的な問題やサポートに関する質問</td>
  </tr>
  <tr>
    <td><a href='mailto:business@dify.ai?subject=[GitHub]Business%20License%20Inquiry'>営業担当</a></td>
    <td>法人ライセンスに関するお問い合わせ</td>
  </tr>
</table>


## ライセンス

このリポジトリは、Dify Open Source License にいくつかの追加制限を加えた[Difyオープンソースライセンス](LICENSE)の下で利用可能です。
