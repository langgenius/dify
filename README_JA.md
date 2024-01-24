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
   <a href="https://dify.ai/blog/dify-ai-unveils-ai-agent-creating-gpts-and-assistants-with-various-llms" target="_blank">
   Dify.AI Unveils AI Agent: Creating GPTs and Assistants with Various LLMs
  </a>
</p>


"Difyは、既にDify.AI上で10万以上のアプリケーションが構築されているLLMアプリケーション開発プラットフォームです。バックエンド・アズ・ア・サービスとLLMOpsの概念を統合し、組み込みのRAGエンジンを含む、生成AIネイティブアプリケーションを構築するためのコアテックスタックをカバーしています。Difyを使用すると、どのLLMに基づいても、Assistants APIやGPTのような機能を自己デプロイすることができます。"

Please note that translating complex technical terms can sometimes result in slight variations in meaning due to differences in language nuances.

![](./images/demo.png)

## クラウドサービスの利用

[Dify.AI Cloud](https://dify.ai) を使用すると、オープンソース版の全機能を利用でき、さらに200GPTのトライアルクレジットが無料で提供されます。

## Difyの利点

Difyはモデルニュートラルであり、LangChainのようなハードコードされた開発ライブラリと比較して、完全にエンジニアリングされた技術スタックを特徴としています。OpenAIのAssistants APIとは異なり、Difyではサービスの完全なローカルデプロイメントが可能です。

| 機能 | Dify.AI | Assistants API | LangChain |
|---------|---------|----------------|-----------|
| **プログラミングアプローチ** | API指向 | API指向 | Pythonコード指向 |
| **エコシステム戦略** | オープンソース | 閉鎖的かつ商業的 | オープンソース |
| **RAGエンジン** | サポート済み | サポート済み | 非サポート |
| **プロンプトIDE** | 含まれる | 含まれる | なし |
| **サポートされるLLMs** | 豊富な種類 | GPTのみ | 豊富な種類 |
| **ローカルデプロイメント** | サポート済み | 非サポート | 該当なし |

 ## 機能

![](./images/models.png)

**1\. LLMサポート**: OpenAIのGPTファミリーモデルやLlama2ファミリーのオープンソースモデルとの統合。 実際、Difyは主要な商用モデルとオープンソースモデル(ローカルでデプロイまたはMaaSベース)をサポートしています。

**2\. プロンプトIDE**: チームとのLLMベースのアプリケーションとサービスの視覚的なオーケストレーション。

**3\. RAGエンジン**: フルテキストインデックスまたはベクトルデータベース埋め込みに基づくさまざまなRAG機能を含み、PDF、TXT、その他のテキストフォーマットの直接アップロードを可能にします。

**4. AIエージェント**: 関数呼び出しとReActに基づくAgent推論フレームワークにより、ユーザーはツールをカスタマイズすることができます。Difyは、Google検索、DELL·E、Stable Diffusion、WolframAlphaなど、十数種類の組み込みツール呼び出し機能を提供しています。

**5\. 継続的運用**: アプリケーションログとパフォーマンスを監視および分析し、運用データを使用してプロンプト、データセット、またはモデルを継続的に改善します。

## 開始する前に

**私たちをスターして、GitHub上でのすべての新しいリリースに対する即時通知を受け取ります！**

![私たちをスターして](https://github.com/langgenius/dify/assets/100913391/95f37259-7370-4456-a9f0-0bc01ef8642f)

- [Website](https://dify.ai)
- [Docs](https://docs.dify.ai)
- [Deployment Docs](https://docs.dify.ai/getting-started/install-self-hosted)
- [FAQ](https://docs.dify.ai/getting-started/faq) 


## コミュニティエディションのインストール

### システム要件

Difyをインストールする前に、以下の最低限のシステム要件を満たしていることを確認してください：

- CPU >= 2コア
- RAM >= 4GB

### クイックスタート

Difyサーバーを始める最も簡単な方法は、[docker-compose.yml](docker/docker-compose.yaml) ファイルを実行することです。インストールコマンドを実行する前に、マシンに [Docker](https://docs.docker.com/get-docker/) と [Docker Compose](https://docs.docker.com/compose/install/) がインストールされていることを確認してください：

```bash
cd docker
docker compose up -d
```

実行後、ブラウザで [http://localhost/install](http://localhost/install) にアクセスし、初期化インストールプロセスを開始できます。

### Helm Chart

@BorisPolonskyによる[Helm Chart](https://helm.sh/) バージョンを提供してくれて、大変感謝しています。これにより、DifyはKubernetes上にデプロイすることができます。
デプロイ情報については、https://github.com/BorisPolonsky/dify-helm をご覧ください。

### 設定

設定をカスタマイズする必要がある場合は、[docker-compose.yml](docker/docker-compose.yaml) ファイルのコメントを参照し、環境設定を手動で行ってください。変更を行った後は、もう一度 `docker-compose up -d` を実行してください。環境変数の完全なリストは、[ドキュメント](https://docs.dify.ai/getting-started/install-self-hosted/environments)で確認できます。


## スターヒストリー

[![Star History Chart](https://api.star-history.com/svg?repos=langgenius/dify&type=Date)](https://star-history.com/#langgenius/dify&Date)

## コミュニティとサポート

Difyに貢献していただき、コードの提出、問題の報告、新しいアイデアの提供、またはDifyを基に作成した興味深く有用なAIアプリケーションの共有により、Difyをより良いものにするお手伝いを歓迎します。同時に、さまざまなイベント、会議、ソーシャルメディアでDifyを共有することも歓迎します。

- [GitHub Issues](https://github.com/langgenius/dify/issues)。最適な使用法：Dify.AIの使用中に遭遇するバグやエラー、[貢献ガイド](CONTRIBUTING.md)を参照。
- [Email サポート](mailto:hello@dify.ai?subject=[GitHub]Questions%20About%20Dify)。最適な使用法：Dify.AIの使用に関する質問。
- [Discord](https://discord.gg/FngNHpbcY7)。最適な使用法：アプリケーションの共有とコミュニティとの交流。
- [Twitter](https://twitter.com/dify_ai)。最適な使用法：アプリケーションの共有とコミュニティとの交流。
- [ビジネスライセンス](mailto:business@dify.ai?subject=[GitHub]Business%20License%20Inquiry)。最適な使用法：Dify.AIを商業利用するためのビジネス関連の問い合わせ。

## セキュリティ

プライバシー保護のため、GitHub へのセキュリティ問題の投稿は避けてください。代わりに、あなたの質問を security@dify.ai に送ってください。より詳細な回答を提供します。

## ライセンス

 このリポジトリは、基本的にApache 2.0にいくつかの追加制限を加えた[Difyオープンソースライセンス](LICENSE)の下で利用できます。
