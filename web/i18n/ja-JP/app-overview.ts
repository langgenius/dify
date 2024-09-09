const translation = {
  welcome: {
    firstStepTip: 'はじめるには、',
    enterKeyTip: '以下にOpenAI APIキーを入力してください',
    getKeyTip: 'OpenAIダッシュボードからAPIキーを取得してください',
    placeholder: 'あなた様のOpenAI APIキー（例：sk-xxxx）',
  },
  apiKeyInfo: {
    cloud: {
      trial: {
        title: '{{providerName}}トライアルクォータを使用しています。',
        description: 'トライアルクォータはテスト用に提供されます。トライアルクォータのコールが使い切られる前に、独自のモデルプロバイダを設定するか、追加のクォータを購入してください。',
      },
      exhausted: {
        title: 'トライアルクォータが使い切れました。APIキーを設定してください。',
        description: 'トライアルクォータが使い切れました。独自のモデルプロバイダを設定するか、追加のクォータを購入してください。',
      },
    },
    selfHost: {
      title: {
        row1: 'はじめるには、',
        row2: 'まずモデルプロバイダを設定してください。',
      },
    },
    callTimes: 'コール回数',
    usedToken: '使用済みトークン',
    setAPIBtn: 'モデルプロバイダの設定へ',
    tryCloud: 'またはDifyのクラウドバージョンを無料見積もりでお試しください',
  },
  overview: {
    title: '概要',
    appInfo: {
      explanation: '使いやすいAI Webアプリ',
      accessibleAddress: '公開URL',
      preview: 'プレビュー',
      regenerate: '再生成',
      regenerateNotice: '公開URLを再生成しますか？',
      preUseReminder: '続行する前にWebアプリを有効にしてください。',
      settings: {
        entry: '設定',
        title: 'Webアプリの設定',
        webName: 'Webアプリの名前',
        webDesc: 'Webアプリの説明',
        webDescTip: 'このテキストはクライアント側に表示され、アプリケーションの使用方法の基本的なガイダンスを提供します。',
        webDescPlaceholder: 'Webアプリの説明を入力してください',
        language: '言語',
        workflow: {
          title: 'ワークフローステップ',
          show: '表示',
          hide: '非表示',
          subTitle: 'ワークフローの詳細',
          showDesc: 'Webアプリでワークフローの詳細を表示または非表示にする',
        },
        chatColorTheme: 'チャットボットのカラーテーマ',
        chatColorThemeDesc: 'チャットボットのカラーテーマを設定します',
        chatColorThemeInverted: '反転',
        invalidHexMessage: '無効な16進数値',
        more: {
          entry: 'その他の設定を表示',
          copyright: '著作権',
          copyRightPlaceholder: '著作者または組織名を入力してください',
          privacyPolicy: 'プライバシーポリシー',
          privacyPolicyPlaceholder: 'プライバシーポリシーリンクを入力してください',
          privacyPolicyTip: '訪問者がアプリケーションが収集するデータを理解し、Difyの<privacyPolicyLink>プライバシーポリシー</privacyPolicyLink>を参照できるようにします。',
          customDisclaimer: 'カスタム免責事項',
          customDisclaimerPlaceholder: '免責事項を入力してください',
          customDisclaimerTip: 'アプリケーションの使用に関する免責事項を提供します。',
        },
        sso: {
          title: 'WebアプリのSSO',
          tooltip: '管理者に問い合わせて、WebアプリのSSOを有効にします',
          label: 'SSO認証',
          description: 'すべてのユーザーは、Webアプリを使用する前にSSOでログインする必要があります',
        },
      },
      embedded: {
        entry: '埋め込み',
        title: 'ウェブサイトに埋め込む',
        explanation: 'チャットアプリをウェブサイトに埋め込む方法を選択します。',
        iframe: 'ウェブサイトの任意の場所にチャットアプリを追加するには、このiframeをHTMLコードに追加してください。',
        scripts: 'ウェブサイトの右下にチャットアプリを追加するには、このコードをHTMLに追加してください。',
        chromePlugin: 'Dify Chatbot Chrome拡張機能をインストール',
        copied: 'コピーしました',
        copy: 'コピー',
      },
      qrcode: {
        title: '共有用QRコード',
        scan: 'アプリケーションの共有をスキャン',
        download: 'QRコードをダウンロード',
      },
      customize: {
        way: '方法',
        entry: 'カスタマイズ',
        title: 'AI Webアプリのカスタマイズ',
        explanation: 'シナリオとスタイルのニーズに合わせてWebアプリのフロントエンドをカスタマイズできます。',
        way1: {
          name: 'クライアントコードをフォークして修正し、Vercelにデプロイします（推奨）',
          step1: 'クライアントコードをフォークして修正します',
          step1Tip: 'ここをクリックしてソースコードをGitHubアカウントにフォークし、コードを修正します',
          step1Operation: 'Dify-WebClient',
          step2: 'Vercelにデプロイします',
          step2Tip: 'ここをクリックしてリポジトリをVercelにインポートし、デプロイします',
          step2Operation: 'リポジトリをインポート',
          step3: '環境変数を設定します',
          step3Tip: 'Vercelに次の環境変数を追加します',
        },
        way2: {
          name: 'クライアントサイドのコードを記述してAPIを呼び出し、サーバーにデプロイします',
          operation: 'ドキュメント',
        },
      },
    },
    apiInfo: {
      title: 'バックエンドサービスAPI',
      explanation: 'あなた様のアプリケーションに簡単に統合できます',
      accessibleAddress: 'サービスAPIエンドポイント',
      doc: 'APIリファレンス',
    },
    status: {
      running: '稼働中',
      disable: '無効',
    },
  },
  analysis: {
    title: '分析',
    ms: 'ms',
    tokenPS: 'トークン/秒',
    totalMessages: {
      title: 'トータルメッセージ数',
      explanation: '日次AIインタラクション数。',
    },
    totalConversations: {
      title: '総会話数',
      explanation: '日次AI会話数；プロンプトエンジニアリング/デバッグは除外。',
    },
    activeUsers: {
      title: 'アクティブユーザー数',
      explanation: 'AIとのQ&Aに参加しているユニークユーザー数；工学的/デバッグ目的のプロンプトは除外されます。',
    },
    tokenUsage: {
      title: 'トークン使用量',
      explanation: 'アプリケーションの言語モデルの日次トークン使用量を反映し、コスト管理に役立ちます。',
      consumed: '消費されたトークン',
    },
    avgSessionInteractions: {
      title: '平均セッションインタラクション数',
      explanation: 'ユーザーとAIの連続的なコミュニケーション数；対話型アプリケーション向け。',
    },
    avgUserInteractions: {
      title: '平均ユーザーインタラクション数',
      explanation: 'ユーザーの日次使用頻度を反映します。この指標はユーザーの定着度を反映しています。',
    },
    userSatisfactionRate: {
      title: 'ユーザー満足度率',
      explanation: '1,000件のメッセージあたりの「いいね」の数。これは、ユーザーが非常に満足している回答の割合を示します。',
    },
    avgResponseTime: {
      title: '平均応答時間',
      explanation: 'AIが処理/応答する時間（ミリ秒）；テキストベースのアプリケーション向け。',
    },
    tps: {
      title: 'トークン出力速度',
      explanation: 'LLMのパフォーマンスを測定します。リクエストの開始から出力の完了までのLLMのトークン出力速度を数えます。',
    },
  },
}

export default translation
