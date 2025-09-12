const translation = {
  subscription: {
    title: '订阅',
    listNum: '{{num}} 个订阅',
    empty: {
      title: '暂无订阅',
      description: '创建您的第一个订阅以开始接收事件',
      button: '新建订阅',
    },
    list: {
      title: '订阅列表',
      addButton: '添加',
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
            title: '删除订阅',
            content: '确定要删除"{{name}}"吗？',
            contentWithApps: '该订阅正在被{{count}}个应用使用。确定要删除"{{name}}"吗？',
            confirm: '删除',
            cancel: '取消',
          },
        },
        status: {
          active: '活跃',
          inactive: '非活跃',
        },
      },
    },
    addType: {
      title: '添加订阅',
      description: '选择创建触发器订阅的方式',
      options: {
        apiKey: {
          title: '通过API密钥',
          description: '使用API凭据自动创建订阅',
        },
        oauth: {
          title: '通过OAuth',
          description: '与第三方平台授权以创建订阅',
        },
        manual: {
          title: '手动设置',
          description: '手动配置Webhook URL和设置',
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
    apiKey: {
      title: '通过API密钥创建',
      verify: {
        title: '验证凭据',
        description: '请提供您的API凭据以验证访问权限',
        error: '凭据验证失败，请检查您的API密钥。',
        success: '凭据验证成功',
      },
      configuration: {
        title: '配置订阅',
        description: '设置您的订阅参数',
      },
    },
    oauth: {
      title: '通过OAuth创建',
      authorization: {
        title: 'OAuth授权',
        description: '授权Dify访问您的账户',
        redirectUrl: '重定向URL',
        redirectUrlHelp: '在您的OAuth应用配置中使用此URL',
        authorizeButton: '使用{{provider}}授权',
        waitingAuth: '等待授权中...',
        authSuccess: '授权成功',
        authFailed: '授权失败',
      },
      configuration: {
        title: '配置订阅',
        description: '授权完成后设置您的订阅参数',
      },
    },
    manual: {
      title: '手动设置',
      description: '手动配置您的Webhook订阅',
      instruction: {
        title: '设置说明',
        step1: '1. 复制下方的回调URL',
        step2: '2. 前往您的第三方平台Webhook设置',
        step3: '3. 将回调URL添加为Webhook端点',
        step4: '4. 配置您想要接收的事件',
        step5: '5. 通过触发事件来测试Webhook',
        step6: '6. 返回此处验证Webhook正常工作并完成设置',
      },
      logs: {
        title: '请求日志',
        description: '监控传入的Webhook请求',
        empty: '尚未收到任何请求。请确保测试您的Webhook配置。',
        status: {
          success: '成功',
          error: '错误',
        },
        expandAll: '展开全部',
        collapseAll: '收起全部',
        timestamp: '时间戳',
        method: '方法',
        path: '路径',
        headers: '请求头',
        body: '请求体',
        response: '响应',
      },
    },
    form: {
      subscriptionName: {
        label: '订阅名称',
        placeholder: '输入订阅名称',
        required: '订阅名称为必填项',
      },
      callbackUrl: {
        label: '回调URL',
        description: '此URL将接收Webhook事件',
        copy: '复制',
        copied: '已复制！',
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
    eventNum: '包含 {{num}} 个 {{event}}',
    item: {
      parameters: '{{count}}个参数',
    },
  },
  provider: {
    github: 'GitHub',
    gitlab: 'GitLab',
    notion: 'Notion',
    webhook: 'Webhook',
  },
}

export default translation
