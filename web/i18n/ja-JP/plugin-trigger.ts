const translation = {
  subscription: {
    title: 'サブスクリプション',
    listNum: '{{num}} サブスクリプション',
    empty: {
      title: 'サブスクリプションがありません',
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
            success: 'サブスクリプション {{name}} は正常に削除されました',
            error: 'サブスクリプション {{name}} の削除に失敗しました',
            confirmInputPlaceholder: '確認するには「{{name}}」と入力してください。',
            confirmInputTip: '確認のため「{{name}}」を入力してください。',
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
    maxCount: '最大 {{num}} 件のサブスクリプション',
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
      },
      logs: {
        title: 'リクエストログ',
        status: {
        },
        request: 'リクエスト',
        loading: '{{pluginName}}からのリクエストを待っています...',
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
        placeholder: '生成中...',
        privateAddressWarning: 'このURLは内部アドレスのようです。Webhookリクエストが失敗する可能性があります。TRIGGER_URL を公開アドレスに変更できます。',
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
    description: 'このトリガープラグインがサブスクライブできるイベント',
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
  },
  node: {
    status: {
      warning: '切断',
    },
  },
}

export default translation
