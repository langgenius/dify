const translation = {
  subscription: {
    title: 'サブスクリプション',
    listNum: '{{num}} サブスクリプション',
    empty: {
      title: 'サブスクリプションがありません',
      description: 'イベントの受信を開始するために最初のサブスクリプションを作成してください',
      button: '新しいサブスクリプション',
    },
    createButton: {
      oauth: 'OAuth で新しいサブスクリプション',
      apiKey: 'API キーで新しいサブスクリプション',
      manual: 'URL を貼り付けて新しいサブスクリプションを作成',
    },
    list: {
      title: 'サブスクリプション',
      addButton: '追加',
      tip: 'サブスクリプション経由でイベントを受信',
      item: {
        enabled: '有効',
        disabled: '無効',
        credentialType: {
          api_key: 'API キー',
          oauth2: 'OAuth',
          unauthorized: '手動',
        },
        actions: {
          delete: '削除',
          deleteConfirm: {
            title: 'サブスクリプションを削除',
            content: '「{{name}}」を削除してもよろしいですか？',
            contentWithApps: 'このサブスクリプションは {{count}} 個のアプリで使用されています。「{{name}}」を削除してもよろしいですか？',
            confirm: '削除',
            cancel: 'キャンセル',
            confirmInputWarning: '確認するために正しい名前を入力してください。',
          },
        },
        status: {
          active: 'アクティブ',
          inactive: '非アクティブ',
        },
        usedByNum: '{{num}} ワークフローで使用中',
        noUsed: 'ワークフローで使用されていません',
      },
    },
    addType: {
      title: 'サブスクリプションを追加',
      description: 'トリガーサブスクリプションの作成方法を選択してください',
      options: {
        apiKey: {
          title: 'API キー経由',
          description: 'API 認証情報を使用してサブスクリプションを自動作成',
        },
        oauth: {
          title: 'OAuth 経由',
          description: 'サードパーティプラットフォームで認証してサブスクリプションを作成',
          custom: 'カスタム',
          default: 'デフォルト',
          clientSettings: 'OAuthクライアント設定',
          clientTitle: 'OAuth クライアント',
        },
        manual: {
          title: '手動設定',
          description: 'URL を貼り付けて新しいサブスクリプションを作成',
          tip: 'サードパーティプラットフォームで URL を手動設定',
        },
        apikey: {
          title: 'APIキーで作成',
          description: 'API資格情報を使用してサブスクリプションを自動的に作成する',
        },
      },
    },
    subscriptionRemoved: 'サブスクリプションが解除されました',
    createSuccess: 'サブスクリプションが正常に作成されました',
    noSubscriptionSelected: 'サブスクリプションが選択されていません',
    selectPlaceholder: 'サブスクリプションを選択',
    createFailed: 'サブスクリプションの作成に失敗しました',
  },
  modal: {
    steps: {
      verify: '検証',
      configuration: '設定',
    },
    common: {
      cancel: 'キャンセル',
      back: '戻る',
      next: '次へ',
      create: '作成',
      verify: '検証',
      authorize: '認証',
      creating: '作成中...',
      verifying: '検証中...',
      authorizing: '認証中...',
    },
    oauthRedirectInfo: 'このツールプロバイダーのシステムクライアントシークレットが見つからないため、手動設定が必要です。redirect_uri には以下を使用してください',
    apiKey: {
      title: 'API キーで作成',
      verify: {
        title: '認証情報を検証',
        description: 'アクセスを検証するために API 認証情報を提供してください',
        error: '認証情報の検証に失敗しました。API キーをご確認ください。',
        success: '認証情報が正常に検証されました',
      },
      configuration: {
        title: 'サブスクリプションを設定',
        description: 'サブスクリプションパラメータを設定',
      },
    },
    oauth: {
      title: 'OAuth で作成',
      authorization: {
        title: 'OAuth 認証',
        description: 'Dify があなたのアカウントにアクセスすることを認証',
        redirectUrl: 'リダイレクト URL',
        redirectUrlHelp: 'OAuth アプリ設定でこの URL を使用',
        authorizeButton: '{{provider}} で認証',
        waitingAuth: '認証を待機中...',
        authSuccess: '認証が成功しました',
        authFailed: '認証に失敗しました',
        waitingJump: '承認済み、ジャンプ待機中',
      },
      configuration: {
        title: 'サブスクリプションを設定',
        description: '認証後にサブスクリプションパラメータを設定',
        success: 'OAuth設定が成功しました',
        failed: 'OAuthの設定に失敗しました',
      },
      remove: {
        success: 'OAuthの削除に成功しました',
        failed: 'OAuthの削除に失敗しました',
      },
      save: {
        success: 'OAuth の設定が正常に保存されました',
      },
    },
    manual: {
      title: '手動設定',
      description: 'Webhook サブスクリプションを手動で設定',
      instruction: {
        title: '設定手順',
        step1: '1. 以下のコールバック URL をコピー',
        step2: '2. サードパーティプラットフォームの Webhook 設定に移動',
        step3: '3. コールバック URL を Webhook エンドポイントとして追加',
        step4: '4. 受信したいイベントを設定',
        step5: '5. イベントをトリガーして Webhook をテスト',
        step6: '6. ここに戻って Webhook が動作していることを確認し、設定を完了',
      },
      logs: {
        title: 'リクエストログ',
        description: '受信 Webhook リクエストを監視',
        empty: 'まだリクエストを受信していません。Webhook 設定をテストしてください。',
        status: {
          success: '成功',
          error: 'エラー',
        },
        expandAll: 'すべて展開',
        collapseAll: 'すべて折りたたむ',
        timestamp: 'タイムスタンプ',
        method: 'メソッド',
        path: 'パス',
        headers: 'ヘッダー',
        body: 'ボディ',
        response: 'レスポンス',
        request: 'リクエスト',
      },
    },
    form: {
      subscriptionName: {
        label: 'サブスクリプション名',
        placeholder: 'サブスクリプション名を入力',
        required: 'サブスクリプション名は必須です',
      },
      callbackUrl: {
        label: 'コールバック URL',
        description: 'この URL で Webhook イベントを受信します',
        copy: 'コピー',
        copied: 'コピーしました！',
        placeholder: '生成中...',
        privateAddressWarning: 'このURLは内部アドレスのようで、Webhookリクエストが失敗する可能性があります。',
        tooltip: 'トリガープロバイダーからのコールバックリクエストを受信できる、公開アクセス可能なエンドポイントを提供してください。',
      },
    },
    errors: {
      createFailed: 'サブスクリプションの作成に失敗しました',
      verifyFailed: '認証情報の検証に失敗しました',
      authFailed: '認証に失敗しました',
      networkError: 'ネットワークエラーです。再試行してください',
    },
  },
  events: {
    title: '利用可能なイベント',
    description: 'このトリガープラグインが購読できるイベント',
    empty: '利用可能なイベントがありません',
    event: 'イベント',
    events: 'イベント',
    actionNum: '{{num}} {{event}} が含まれています',
    item: {
      parameters: '{{count}} パラメータ',
      noParameters: 'パラメータなし',
    },
    output: '出力',
  },
  provider: {
    github: 'GitHub',
    gitlab: 'GitLab',
    notion: 'Notion',
    webhook: 'Webhook',
  },
  node: {
    status: {
      warning: '切断',
    },
  },
}

export default translation
