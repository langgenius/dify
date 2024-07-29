Dify にコントリビュートしたいとお考えなのですね。それは素晴らしいことです。
私たちは、LLM アプリケーションの構築と管理のための最も直感的なワークフローを設計するという壮大な野望を持っています。人数も資金も限られている新興企業として、コミュニティからの支援は本当に重要です。

私たちは現状を鑑み、機敏かつ迅速に開発をする必要がありますが、同時にあなた様のようなコントリビューターの方々に、可能な限りスムーズな貢献体験をしていただきたいと思っています。そのためにこのコントリビュートガイドを作成しました。
コードベースやコントリビュータの方々と私たちがどのように仕事をしているのかに慣れていただき、楽しいパートにすぐに飛び込めるようにすることが目的です。

このガイドは Dify そのものと同様に、継続的に改善されています。実際のプロジェクトに遅れをとることがあるかもしれませんが、ご理解のほどよろしくお願いいたします。

ライセンスに関しては、私たちの短い[ライセンスおよびコントリビューター規約](./LICENSE)をお読みください。また、コミュニティは[行動規範](https://github.com/langgenius/.github/blob/main/CODE_OF_CONDUCT.md)を遵守しています。

## 飛び込む前に

[既存の Issue](https://github.com/langgenius/dify/issues?q=is:issue+is:closed) を探すか、[新しい Issue](https://github.com/langgenius/dify/issues/new/choose) を作成してください。私たちは Issue を 2 つのタイプに分類しています。

### 機能リクエスト

* 新しい機能要望を出す場合は、提案する機能が何を実現するものなのかを説明し、可能な限り多くのコンテキストを含めてください。[@perzeusss](https://github.com/perzeuss)は、あなた様の要望を書き出すのに役立つ [Feature Request Copilot](https://udify.app/chat/MK2kVSnw1gakVwMX) を作ってくれました。気軽に試してみてください。

* 既存の課題から 1 つ選びたい場合は、その下にコメントを書いてください。

  関連する方向で作業しているチームメンバーが参加します。すべてが良好であれば、コーディングを開始する許可が与えられます。私たちが変更を提案した場合にあなた様の作業が無駄になることがないよう、それまでこの機能の作業を控えていただくようお願いいたします。

  提案された機能がどの分野に属するかによって、あなた様は異なるチーム・メンバーと話をするかもしれません。以下は、各チームメンバーが現在取り組んでいる分野の概要です。

| Member                                                                                  | Scope                                |
| --------------------------------------------------------------------------------------- | ------------------------------------ |
| [@yeuoly](https://github.com/Yeuoly)                                                    | エージェントアーキテクチャ           |
| [@jyong](https://github.com/JohnJyong)                                                  | RAG パイプライン設計                 |
| [@GarfieldDai](https://github.com/GarfieldDai)                                          | workflow orchestrations の構築       |
| [@iamjoel](https://github.com/iamjoel) & [@zxhlyh](https://github.com/zxhlyh)           | フロントエンドを使いやすくする       |
| [@guchenhe](https://github.com/guchenhe) & [@crazywoola](https://github.com/crazywoola) | 開発者体験、何でも相談できる窓口     |
| [@takatost](https://github.com/takatost)                                                | 全体的な製品の方向性とアーキテクチャ |

優先順位の付け方:

| Feature Type                                                                                                          | Priority        |
| --------------------------------------------------------------------------------------------------------------------- | --------------- |
| チームメンバーによってラベル付けされた優先度の高い機能                                                                | High Priority   |
| [community feedback board](https://github.com/langgenius/dify/discussions/categories/feedbacks)の人気の機能リクエスト | Medium Priority |
| 非コア機能とマイナーな機能強化                                                                                        | Low Priority    |
| 価値はあるが即効性はない                                                                                              | Future-Feature  |

### その他 (バグレポート、パフォーマンスの最適化、誤字の修正など)

* すぐにコーディングを始めてください

優先順位の付け方:

| Issue Type                                                                             | Priority        |
| -------------------------------------------------------------------------------------- | --------------- |
| コア機能のバグ（ログインできない、アプリケーションが動作しない、セキュリティの抜け穴） | Critical        |
| 致命的でないバグ、パフォーマンス向上                                                   | Medium Priority |
| 細かな修正（誤字脱字、機能はするが分かりにくい UI）                                  | Low Priority    |

## インストール

以下の手順で 、Difyのセットアップをしてください。

### 1. このリポジトリをフォークする

### 2. リポジトリをクローンする

フォークしたリポジトリをターミナルからクローンします。

```
git clone git@github.com:<github_username>/dify.git
```

### 3. 依存関係の確認

Dify を構築するには次の依存関係が必要です。それらがシステムにインストールされていることを確認してください。

- [Docker](https://www.docker.com/)
- [Docker Compose](https://docs.docker.com/compose/install/)
- [Node.js v18.x (LTS)](http://nodejs.org)
- [npm](https://www.npmjs.com/) version 8.x.x or [Yarn](https://yarnpkg.com/)
- [Python](https://www.python.org/) version 3.10.x

### 4. インストール

Dify はバックエンドとフロントエンドから構成されています。
まず`cd api/`でバックエンドのディレクトリに移動し、[Backend README](api/README.md)に従ってインストールします。
次に別のターミナルで、`cd web/`でフロントエンドのディレクトリに移動し、[Frontend README](web/README.md)に従ってインストールしてください。

よくある問題とトラブルシューティングの手順については、[installation FAQ](https://docs.dify.ai/v/japanese/learn-more/faq/install-faq) を確認してください。

### 5. ブラウザで dify にアクセスする

設定を確認するために、ブラウザで[http://localhost:3000](http://localhost:3000)(デフォルト、または自分で設定した URL とポート)にアクセスしてください。Dify が起動して実行中であることが確認できるはずです。

## 開発中

モデルプロバイダーを追加する場合は、[このガイド](https://github.com/langgenius/dify/blob/main/api/core/model_runtime/README.md)が役立ちます。

Agent や Workflow にツールプロバイダーを追加する場合は、[このガイド](./api/core/tools/README.md)が役立ちます。

Dify のバックエンドとフロントエンドの概要を簡単に説明します。

### バックエンド

Dify のバックエンドは[Flask](https://flask.palletsprojects.com/en/3.0.x/)を使って Python で書かれています。ORM には[SQLAlchemy](https://www.sqlalchemy.org/)を、タスクキューには[Celery](https://docs.celeryq.dev/en/stable/getting-started/introduction.html)を使っています。認証ロジックは Flask-login 経由で行われます。

```
[api/]
├── constants             // コードベース全体で使用される定数設定
├── controllers           // APIルート定義とリクエスト処理ロジック
├── core                  // アプリケーションの中核的な管理、モデル統合、およびツール
├── docker                // Dockerおよびコンテナ関連の設定
├── events                // イベントのハンドリングと処理
├── extensions            // 第三者のフレームワーク/プラットフォームとの拡張
├── fields                // シリアライゼーション/マーシャリング用のフィールド定義
├── libs                  // 再利用可能なライブラリとヘルパー
├── migrations            // データベースマイグレーションスクリプト
├── models                // データベースモデルとスキーマ定義
├── services              // ビジネスロジックの定義
├── storage               // 秘密鍵の保存
├── tasks                 // 非同期タスクとバックグラウンドジョブの処理
└── tests                 // テスト関連のファイル
```

### フロントエンド

このウェブサイトは、Typescriptベースの[Next.js](https://nextjs.org/)テンプレートを使ってブートストラップされ、[Tailwind CSS](https://tailwindcss.com/)を使ってスタイリングされています。国際化には[React-i18next](https://react.i18next.com/)を使用しています。

```
[web/]
├── app                   // レイアウト、ページ、コンポーネント
│   ├── (commonLayout)    // アプリ全体で共通のレイアウト
│   ├── (shareLayout)     // トークン特有のセッションで共有されるレイアウト
│   ├── activate          // アクティベートページ
│   ├── components        // ページやレイアウトで共有されるコンポーネント
│   ├── install           // インストールページ
│   ├── signin            // サインインページ
│   └── styles            // グローバルに共有されるスタイル
├── assets                // 静的アセット
├── bin                   // ビルドステップで実行されるスクリプト
├── config                // 調整可能な設定とオプション
├── context               // アプリの異なる部分で使用される共有コンテキスト
├── dictionaries          // 言語別の翻訳ファイル
├── docker                // コンテナ設定
├── hooks                 // 再利用可能なフック
├── i18n                  // 国際化設定
├── models                // データモデルとAPIレスポンスの形状を記述
├── public                // ファビコンなどのメタアセット
├── service               // APIアクションの形状を指定
├── test
├── types                 // 関数のパラメータと戻り値の記述
└── utils                 // 共有ユーティリティ関数
```

## PR を投稿する

いよいよ、私たちのリポジトリにプルリクエスト (PR) を提出する時が来ました。主要な機能については、まず `deploy/dev` ブランチにマージしてテストしてから `main` ブランチにマージします。
マージ競合などの問題が発生した場合、またはプル リクエストを開く方法がわからない場合は、[GitHub's pull request tutorial](https://docs.github.com/en/pull-requests/collaborating-with-pull-requests) をチェックしてみてください。

これで完了です！あなた様の PR がマージされると、[README](https://github.com/langgenius/dify/blob/main/README.md) にコントリビューターとして紹介されます。

## ヘルプを得る

コントリビュート中に行き詰まったり、疑問が生じたりした場合は、GitHub の関連する issue から質問していただくか、[Discord](https://discord.gg/8Tpq4AcN9c)でチャットしてください。
