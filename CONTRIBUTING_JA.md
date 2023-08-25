# コントリビュート

[Dify](https://dify.ai) に興味を持ち、貢献したいと思うようになったことに感謝します！始める前に、
[行動規範](https://github.com/langgenius/.github/blob/main/CODE_OF_CONDUCT.md)を読み、
[既存の問題](https://github.com/langgenius/langgenius-gateway/issues)をチェックしてください。
本ドキュメントは、[Dify](https://dify.ai) をビルドしてテストするための開発環境の構築方法を説明するものです。

### 依存関係のインストール

[Dify](https://dify.ai)をビルドするには、お使いのマシンに以下の依存関係をインストールし、設定する必要があります:

- [Git](http://git-scm.com/)
- [Docker](https://www.docker.com/)
- [Docker Compose](https://docs.docker.com/compose/install/)
- [Node.js v18.x (LTS)](http://nodejs.org)
- [npm](https://www.npmjs.com/) バージョン 8.x.x もしくは [Yarn](https://yarnpkg.com/)
- [Python](https://www.python.org/) バージョン 3.10.x

## ローカル開発

開発環境を構築するには、プロジェクトの git リポジトリをフォークし、適切なパッケージマネージャを使用してバックエンドとフロントエンドの依存関係をインストールし、docker-compose スタックを実行するように作成します。

### リポジトリのフォーク

[リポジトリ](https://github.com/langgenius/dify) をフォークする必要があります。

### リポジトリのクローン

GitHub でフォークしたリポジトリのクローンを作成する:

```
git clone git@github.com:<github_username>/dify.git
```

### バックエンドのインストール

バックエンドアプリケーションのインストール方法については、[Backend README](api/README.md) を参照してください。

### フロントエンドのインストール

フロントエンドアプリケーションのインストール方法については、[Frontend README](web/README.md) を参照してください。

### ブラウザで dify にアクセス

[Dify](https://dify.ai) をローカル環境で見ることができるようになりました [http://localhost:3000](http://localhost:3000)。

## プルリクエストの作成

変更後、プルリクエスト (PR) をオープンしてください。プルリクエストを提出すると、Dify チーム/コミュニティの他の人があなたと一緒にそれをレビューします。

マージコンフリクトなどの問題が発生したり、プルリクエストの開き方がわからなくなったりしませんでしたか？ [GitHub's pull request tutorial](https://docs.github.com/en/pull-requests/collaborating-with-pull-requests) で、マージコンフリクトやその他の問題を解決する方法をチェックしてみてください。あなたの PR がマージされると、[コントリビュータチャート](https://github.com/langgenius/langgenius-gateway/graphs/contributors)にコントリビュータとして誇らしげに掲載されます。

## コミュニティチャンネル

お困りですか？何か質問がありますか？ [Discord Community サーバ](https://discord.gg/AhzKf7dNgk)に参加してください。私たちがお手伝いします！
