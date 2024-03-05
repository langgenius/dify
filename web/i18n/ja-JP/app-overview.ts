const translation = {
  welcome: {
    firstStepTip: '始めるには、',
    enterKeyTip: '以下にOpenAI APIキーを入力してください',
    getKeyTip: 'OpenAIダッシュボードからAPIキーを取得してください',
    placeholder: 'OpenAI APIキー（例：sk-xxxx）',
  },
  apiKeyInfo: {
    cloud: {
      trial: {
        title: '{{providerName}}のトライアルクオータを使用しています。',
        description: 'トライアルクオータはテスト用に提供されています。トライアルクオータの使用回数が尽きる前に、独自のモデルプロバイダを設定するか、追加のクオータを購入してください。',
      },
      exhausted: {
        title: 'トライアルクオータが使い果たされました。APIキーを設定してください。',
        description: 'トライアルクオータが使い果たされました。独自のモデルプロバイダを設定するか、追加のクオータを購入してください。',
      },
    },
    selfHost: {
      title: {
        row1: '始めるには、',
        row2: 'まずモデルプロバイダを設定してください。',
      },
    },
    callTimes: '呼び出し回数',
    usedToken: '使用済みトークン',
    setAPIBtn: 'モデルプロバイダの設定へ',
    tryCloud: 'または無料クオートでDifyのクラウドバージョンを試してみてください',
  },
  overview: {
    title: '概要',
    appInfo: {
      explanation: '使いやすいAI Webアプリ',
      accessibleAddress: '公開URL',
      preview: 'プレビュー',
      regenerate: '再生成',
      preUseReminder: '続行する前にWebアプリを有効にしてください。',
      settings: {
        entry: '設定',
        title: 'Webアプリの設定',
        webName: 'Webアプリ名',
        webDesc: 'Webアプリの説明',
        webDescTip: 'このテキストはクライアント側に表示され、アプリの使用方法に関する基本的なガイダンスを提供します。',
        webDescPlaceholder: 'Webアプリの説明を入力してください',
        language: '言語',
        more: {
          entry: '詳細設定を表示',
          copyright: '著作権',
          copyRightPlaceholder: '著作者または組織の名前を入力してください',
          privacyPolicy: 'プライバシーポリシー',
          privacyPolicyPlaceholder: 'プライバシーポリシーリンクを入力してください',
          privacyPolicyTip: '訪問者がアプリが収集するデータを理解するのに役立ちます。Difyの<privacyPolicyLink>プライバシーポリシー</privacyPolicyLink>を参照してください。',
        },
      },
      embedded: {
        entry: '埋め込み',
        title: 'ウェブサイトに埋め込む',
        explanation: 'チャットアプリをウェブサイトに埋め込む方法を選択してください。',
        iframe: 'ウェブサイトの任意の場所にチャットアプリを追加するには、このiframeをHTMLコードに追加してください。',
        scripts: 'ウェブサイトの右下にチャットアプリを追加するには、このコードをHTMLに追加してください。',
        chromePlugin: 'Dify Chatbot Chrome拡張機能をインストール',
        copied: 'コピー済み',
        copy: 'コピー',
      },
      qrcode: {
        title: '共有用QRコード',
        scan: 'アプリを共有するためにスキャン',
        download: 'QRコードをダウンロード',
      },
      customize: {
        way: '方法',
        entry: 'カスタマイズ',
        title: 'AI Webアプリのカスタマイズ',
        explanation: 'シナリオとスタイルのニーズに合わせてWebアプリのフロントエンドをカスタマイズできます。',
        way1: {
          name: 'クライアントコードをフォークして変更し、Vercelにデプロイする（推奨）',
          step1: 'クライアントコードをフォークして変更する',
          step1Tip: 'ここをクリックしてソースコードをGitHubアカウントにフォークし、コードを変更してください',
          step1Operation: 'Dify-WebClient',
          step2: 'Vercelにデプロイする',
          step2Tip: 'ここをクリックしてリポジトリをVercelにインポートし、デプロイしてください',
          step2Operation: 'リポジトリのインポート',
          step3: '環境変数を設定する',
          step3Tip: 'Vercelに以下の環境変数を追加してください',
        },
        way2: {
          name: 'APIを呼び出すためのクライアントサイドコードを記述し、サーバーにデプロイする',
          operation: 'ドキュメント',
        },
      },
    },
    apiInfo: {
      title: 'バックエンドサービスAPI',
      explanation: 'アプリケーションに簡単に統合できます',
      accessibleAddress: 'サービスAPIエンドポイント',
      doc: 'APIリファレンス',
    },
    status: {
      running: 'サービス中',
      disable: '無効化',
    },
  },
  analysis: {
    title: '分析',
    ms: 'ミリ秒',
    tokenPS: 'トークン/秒',
    totalMessages: {
      title: '総メッセージ数',
      explanation: 'AIとのやり取りのうち、プロンプトのエンジニアリングやデバッグを除いた日次の相互作用数です。',
    },
    activeUsers: {
      title: 'アクティブユーザー',
      explanation: 'AIとのQ&Aに参加しているユニークなユーザー数です。プロンプトのエンジニアリングやデバッグを除きます。',
    },
    tokenUsage: {
      title: 'トークン使用量',
      explanation: 'アプリケーションの言語モデルの日次トークン使用量を反映し、コスト管理の目的に役立ちます。',
      consumed: '使用済み',
    },
    avgSessionInteractions: {
      title: '平均セッション相互作用数',
      explanation: '会話ベースのアプリケーションの連続したユーザーとAIのコミュニケーション数です。',
    },
    userSatisfactionRate: {
      title: 'ユーザー満足率',
      explanation: '1,000メッセージあたりの「いいね」の数です。これは、ユーザーが非常に満足している回答の割合を示します。',
    },
    avgResponseTime: {
      title: '平均応答時間',
      explanation: 'AIの処理/応答にかかる時間（ミリ秒）です。テキストベースのアプリケーションに適しています。',
    },
    tps: {
      title: 'トークン出力速度',
      explanation: 'LLMのパフォーマンスを測定します。リクエストの開始から出力の完了までのLLMのトークン出力速度をカウントします。',
    },
  },
}

export default translation
