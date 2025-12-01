const translation = {
  subscription: {
    title: '订阅',
    listNum: '{{num}} 个订阅',
    empty: {
      title: '暂无订阅',
      button: '新建订阅',
    },
    createButton: {
      oauth: '通过 OAuth 新建订阅',
      apiKey: '通过 API Key 新建订阅',
      manual: '粘贴 URL 以创建新订阅',
    },
    createSuccess: '订阅创建成功',
    createFailed: '订阅创建失败',
    maxCount: '最多 {{num}} 个订阅',
    selectPlaceholder: '选择订阅',
    noSubscriptionSelected: '未选择订阅',
    subscriptionRemoved: '订阅已移除',
    list: {
      title: '订阅列表',
      addButton: '添加',
      tip: '通过订阅接收事件',
      item: {
        enabled: '已启用',
        disabled: '已禁用',
        credentialType: {
          api_key: 'API密钥',
          oauth2: 'OAuth',
          unauthorized: '手动',
        },
        actions: {
          delete: '删除',
          deleteConfirm: {
            title: '删除 {{name}}？',
            success: '订阅 {{name}} 删除成功',
            error: '订阅 {{name}} 删除失败',
            content: '删除后，该订阅将无法恢复，请确认。',
            contentWithApps: '该订阅正在被 {{count}} 个应用使用，删除它将导致这些应用停止接收订阅事件。',
            confirm: '确认删除',
            cancel: '取消',
            confirmInputWarning: '请输入正确的名称确认。',
            confirmInputPlaceholder: '输入 "{{name}}" 确认',
            confirmInputTip: '请输入 “{{name}}” 确认：',
          },
        },
        status: {
          active: '活跃',
          inactive: '非活跃',
        },
        usedByNum: '被 {{num}} 个工作流使用',
        noUsed: '未被工作流使用',
      },
    },
    addType: {
      title: '添加订阅',
      description: '选择创建触发器订阅的方式',
      options: {
        apikey: {
          title: '通过 API Key 创建',
          description: '使用 API 凭据自动创建订阅',
        },
        oauth: {
          title: '通过 OAuth 创建',
          description: '与第三方平台授权以创建订阅',
          clientSettings: 'OAuth 客户端设置',
          clientTitle: 'OAuth 客户端',
          default: '默认',
          custom: '自定义',
        },
        manual: {
          title: '手动设置',
          description: '粘贴 URL 以创建新订阅',
          tip: '手动配置 URL 到第三方平台',
        },
      },
    },
  },
  modal: {
    steps: {
      verify: '验证',
      configuration: '配置',
    },
    common: {
      cancel: '取消',
      back: '返回',
      next: '下一步',
      create: '创建',
      verify: '验证',
      authorize: '授权',
      creating: '创建中...',
      verifying: '验证中...',
      authorizing: '授权中...',
    },
    oauthRedirectInfo: '由于未找到此工具提供方的系统客户端密钥，需要手动设置，对于 redirect_uri，请使用',
    apiKey: {
      title: '通过 API Key 创建',
      verify: {
        title: '验证凭据',
        description: '请提供您的 API 凭据以验证访问权限',
        error: '凭据验证失败，请检查您的 API 密钥。',
        success: '凭据验证成功',
      },
      configuration: {
        title: '配置订阅',
        description: '设置您的订阅参数',
      },
    },
    oauth: {
      title: '通过 OAuth 创建',
      authorization: {
        title: 'OAuth 授权',
        description: '授权 Dify 访问您的账户',
        redirectUrl: '重定向 URL',
        redirectUrlHelp: '在您的 OAuth 应用配置中使用此 URL',
        authorizeButton: '使用 {{provider}} 授权',
        waitingAuth: '等待授权中...',
        authSuccess: '授权成功',
        authFailed: '获取 OAuth 授权信息失败',
        waitingJump: '已授权，待跳转',
      },
      configuration: {
        title: '配置订阅',
        description: '授权完成后设置您的订阅参数',
        success: 'OAuth 配置成功',
        failed: 'OAuth 配置失败',
      },
      remove: {
        success: 'OAuth 移除成功',
        failed: 'OAuth 移除失败',
      },
      save: {
        success: 'OAuth 配置保存成功',
      },
    },
    manual: {
      title: '手动设置',
      description: '手动配置您的 Webhook 订阅',
      logs: {
        title: '请求日志',
        request: '请求',
        loading: '等待 {{pluginName}} 的请求...',
      },
    },
    form: {
      subscriptionName: {
        label: '订阅名称',
        placeholder: '输入订阅名称',
        required: '订阅名称为必填项',
      },
      callbackUrl: {
        label: '回调 URL',
        description: '此 URL 将接收Webhook事件',
        tooltip: '填写能被触发器提供方访问的公网地址，用于接收回调请求。',
        placeholder: '生成中...',
        privateAddressWarning: '此 URL 似乎是一个内部地址，可能会导致 Webhook 请求失败。',
      },
    },
    errors: {
      createFailed: '创建订阅失败',
      verifyFailed: '验证凭据失败',
      authFailed: '授权失败',
      networkError: '网络错误，请重试',
    },
  },
  events: {
    title: '可用事件',
    description: '此触发器插件可以订阅的事件',
    empty: '没有可用事件',
    event: '事件',
    events: '事件',
    actionNum: '包含 {{num}} 个 {{event}}',
    item: {
      parameters: '{{count}}个参数',
      noParameters: '暂无参数',
    },
    output: '输出',
  },
  node: {
    status: {
      warning: '未连接',
    },
  },
}

export default translation
