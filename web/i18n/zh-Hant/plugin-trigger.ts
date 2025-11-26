const translation = {
  subscription: {
    title: '訂閱',
    listNum: '{{num}} 訂閱',
    empty: {
      title: '無訂閱',
      button: '新訂閱',
    },
    createButton: {
      oauth: '使用 OAuth 的新訂閱',
      apiKey: '使用 API 金鑰的新訂閱',
      manual: '貼上網址以建立新訂閱',
    },
    createSuccess: '訂閱已成功建立',
    createFailed: '建立訂閱失敗',
    maxCount: '最多 {{num}} 訂閱',
    selectPlaceholder: '選擇訂閱',
    noSubscriptionSelected: '未選擇訂閱',
    subscriptionRemoved: '已取消訂閱',
    list: {
      title: '訂閱',
      addButton: '添加',
      tip: '透過訂閱接收事件',
      item: {
        enabled: '已啟用',
        disabled: '已停用',
        credentialType: {
          api_key: 'API 金鑰',
          oauth2: 'OAuth',
          unauthorized: '手冊',
        },
        actions: {
          delete: '刪除',
          deleteConfirm: {
            title: '刪除 {{name}}？',
            success: '訂閱 {{name}} 已成功刪除',
            error: '無法刪除訂閱 {{name}}',
            content: '一旦刪除，此訂閱將無法恢復。請確認。',
            contentWithApps: '當前訂閱被 {{count}} 個應用程式引用。刪除它將導致已配置的應用程式停止接收訂閱事件。',
            confirm: '確認刪除',
            cancel: '取消',
            confirmInputWarning: '請輸入正確的名稱以確認。',
            confirmInputPlaceholder: '輸入「{{name}}」以確認。',
            confirmInputTip: '請輸入「{{name}}」以確認。',
          },
        },
        status: {
          active: '活躍',
          inactive: '未啟用',
        },
        usedByNum: '被 {{num}} 工作流程使用',
        noUsed: '未使用工作流程',
      },
    },
    addType: {
      title: '新增訂閱',
      description: '選擇您想要建立觸發訂閱的方式',
      options: {
        apikey: {
          title: '使用 API 金鑰創建',
          description: '使用 API 憑證自動建立訂閱',
        },
        oauth: {
          title: '使用 OAuth 創建',
          description: '授權第三方平台以建立訂閱',
          clientSettings: 'OAuth 客戶端設定',
          clientTitle: 'OAuth 用戶端',
          default: '預設',
          custom: '自訂',
        },
        manual: {
          title: '手動設定',
          description: '貼上網址以建立新訂閱',
          tip: '手動在第三方平台上配置 URL',
        },
      },
    },
  },
  modal: {
    steps: {
      verify: '驗證',
      configuration: '配置',
    },
    common: {
      cancel: '取消',
      back: '返回',
      next: '下一步',
      create: '創建',
      verify: '驗證',
      authorize: '授權',
      creating: '正在建立...',
      verifying: '驗證中…',
      authorizing: '授權中…',
    },
    oauthRedirectInfo: '由於未找到此工具提供者的系統用戶端密鑰，需要手動設定，至於 redirect_uri，請使用',
    apiKey: {
      title: '使用 API 金鑰創建',
      verify: {
        title: '驗證憑證',
        description: '請提供您的 API 憑證以驗證存取權限',
        error: '憑證驗證失敗。請檢查您的 API 金鑰。',
        success: '憑證驗證成功',
      },
      configuration: {
        title: '設定訂閱',
        description: '設定您的訂閱參數',
      },
    },
    oauth: {
      title: '使用 OAuth 創建',
      authorization: {
        title: 'OAuth 授權',
        description: '授權 Dify 存取您的帳戶',
        redirectUrl: '重新導向網址',
        redirectUrlHelp: '在您的 OAuth 應用程式設定中使用此 URL',
        authorizeButton: '使用 {{provider}} 授權',
        waitingAuth: '等待授權中...',
        authSuccess: '授權成功',
        authFailed: '無法取得 OAuth 認證資訊',
        waitingJump: '已授權，等待起跳',
      },
      configuration: {
        title: '設定訂閱',
        description: '授權後設定您的訂閱參數',
        success: 'OAuth 配置成功',
        failed: 'OAuth 配置失敗',
      },
      remove: {
        success: 'OAuth 移除成功',
        failed: 'OAuth 移除失敗',
      },
      save: {
        success: 'OAuth 設定已成功保存',
      },
    },
    manual: {
      title: '手動設定',
      description: '手動配置您的 Webhook 訂閱',
      logs: {
        title: '請求日誌',
        request: '請求',
        loading: '正在等待來自 {{pluginName}} 的請求...',
      },
    },
    form: {
      subscriptionName: {
        label: '訂閱名稱',
        placeholder: '輸入訂閱名稱',
        required: '需要訂閱名稱',
      },
      callbackUrl: {
        label: '回呼網址',
        description: '此 URL 將接收 webhook 事件',
        tooltip: '提供一個可公開訪問的端點，以接收來自觸發提供者的回調請求。',
        placeholder: '生成中...',
        privateAddressWarning: '此 URL 似乎是內部位址，可能會導致 webhook 請求失敗。您可以將 TRIGGER_URL 更改為公開位址。',
      },
    },
    errors: {
      createFailed: '建立訂閱失敗',
      verifyFailed: '驗證憑證失敗',
      authFailed: '授權失敗',
      networkError: '網絡錯誤，請再試一次',
    },
  },
  events: {
    title: '可用活動',
    description: '此觸發插件可以訂閱的事件',
    empty: '沒有可用的活動',
    event: '活動',
    events: '活動',
    actionNum: '{{num}} {{event}} 已包含',
    item: {
      parameters: '{{count}} 參數',
      noParameters: '無參數',
    },
    output: '輸出',
  },
  node: {
    status: {
      warning: '斷開連接',
    },
  },
}

export default translation
