const translation = {
  welcome: {
    firstStepTip: '开始之前,',
    enterKeyTip: '请先在下方输入你的 OpenAI API Key',
    getKeyTip: '从 OpenAI 获取你的 API Key',
    placeholder: '你的 OpenAI API Key（例如 sk-xxxx）',
  },
  apiKeyInfo: {
    cloud: {
      trial: {
        title: '您正在使用 {{providerName}} 的试用配额。',
        description: '试用配额仅供您测试使用。 在试用配额用完之前，请自行设置模型提供商或购买额外配额。',
      },
      exhausted: {
        title: '您的试用额度已用完，请设置您的APIKey。',
        description: '您的试用配额已用完。 请设置您自己的模型提供商或购买额外配额。',
      },
    },
    selfHost: {
      title: {
        row1: '首先，',
        row2: '设置您的模型提供商。',
      },
    },
    callTimes: '调用次数',
    usedToken: '使用 Tokens',
    setAPIBtn: '设置模型提供商',
    tryCloud: '或者尝试使用 Dify 的云版本并使用试用配额',
  },
  overview: {
    title: '概览',
    appInfo: {
      explanation: '开箱即用的 AI WebApp',
      accessibleAddress: '公开访问 URL',
      preview: '预览',
      launch: '启动',
      regenerate: '重新生成',
      regenerateNotice: '您是否要重新生成公开访问 URL？',
      preUseReminder: '使用前请先打开开关',
      settings: {
        entry: '设置',
        title: 'WebApp 设置',
        modalTip: '客户端 WebApp 设置。',
        webName: 'WebApp 名称',
        webDesc: 'WebApp 描述',
        webDescTip: '以下文字将展示在客户端中，对应用进行说明和使用上的基本引导',
        webDescPlaceholder: '请输入 WebApp 的描述',
        language: '语言',
        workflow: {
          title: '工作流',
          subTitle: '工作流详情',
          show: '显示',
          hide: '隐藏',
          showDesc: '在 WebApp 中展示或者隐藏工作流详情',
        },
        chatColorTheme: '聊天颜色主题',
        chatColorThemeDesc: '设置聊天机器人的颜色主题',
        chatColorThemeInverted: '反转',
        invalidHexMessage: '无效的十六进制值',
        sso: {
          label: '单点登录认证',
          title: 'WebApp SSO 认证',
          description: '启用后，所有用户都需要先进行 SSO 认证才能访问',
          tooltip: '联系管理员以开启 WebApp SSO 认证',
        },
        more: {
          entry: '展示更多设置',
          copyright: '版权',
          copyrightTip: '在 WebApp 中展示版权信息',
          copyrightTooltip: '请升级到专业版或者更高',
          copyRightPlaceholder: '请输入作者或组织名称',
          privacyPolicy: '隐私政策',
          privacyPolicyPlaceholder: '请输入隐私政策链接',
          privacyPolicyTip: '帮助访问者了解该应用收集的数据，可参考 Dify 的<privacyPolicyLink>隐私政策</privacyPolicyLink>。',
          customDisclaimer: '自定义免责声明',
          customDisclaimerPlaceholder: '请输入免责声明',
          customDisclaimerTip: '在应用中展示免责声明，可用于告知用户 AI 的局限性。',
        },
      },
      embedded: {
        entry: '嵌入',
        title: '嵌入到网站中',
        explanation: '选择一种方式将聊天应用嵌入到你的网站中',
        iframe: '将以下 iframe 嵌入到你的网站中的目标位置',
        scripts: '将以下代码嵌入到你的网站中',
        chromePlugin: '安装 Dify Chrome 浏览器扩展',
        copied: '已复制',
        copy: '复制',
      },
      qrcode: {
        title: '二维码分享',
        scan: '扫码分享应用',
        download: '下载二维码',
      },
      customize: {
        way: '方法',
        entry: '定制化',
        title: '定制化 AI WebApp',
        explanation: '你可以定制化 Web App 前端以符合你的情景与风格需求',
        way1: {
          name: 'Fork 客户端代码修改后部署到 Vercel（推荐）',
          step1: 'Fork 客户端代码并修改',
          step1Tip: '点击此处 Fork 源码到你的 GitHub 中，然后修改代码',
          step1Operation: 'Dify-WebClient',
          step2: '部署到 Vercel 中',
          step2Tip: '点击此处将仓库导入到 Vercel 中部署',
          step2Operation: '导入仓库',
          step3: '配置环境变量',
          step3Tip: '在 Vecel 环境变量中添加以下环境变量',
        },
        way2: {
          name: '编写客户端调用 API 并部署到服务器中',
          operation: '查看文档',
        },
      },
    },
    apiInfo: {
      title: '后端服务 API',
      explanation: '可集成至你的应用的后端即服务',
      accessibleAddress: 'API 访问凭据',
      doc: '查阅 API 文档',
    },
    status: {
      running: '运行中',
      disable: '已停用',
    },
  },
  analysis: {
    title: '分析',
    ms: '毫秒',
    tokenPS: 'Token/秒',
    totalMessages: {
      title: '全部消息数',
      explanation: '反映 AI 每天的互动总次数，每回答用户一个问题算一条 Message。',
    },
    totalConversations: {
      title: '全部会话数',
      explanation: '反映 AI 每天的会话总次数，提示词编排和调试的消息不计入。',
    },
    activeUsers: {
      title: '活跃用户数',
      explanation: '与 AI 有效互动，即有一问一答以上的唯一用户数。提示词编排和调试的会话不计入。',
    },
    tokenUsage: {
      title: '费用消耗',
      explanation: '反映每日该应用请求语言模型的 Tokens 花费，用于成本控制。',
      consumed: '耗费',
    },
    avgSessionInteractions: {
      title: '平均会话互动数',
      explanation: '反应每个会话用户的持续沟通次数，如果用户与 AI 问答了 10 轮，即为 10。该指标反映了用户粘性。仅在对话型应用提供。',
    },
    avgUserInteractions: {
      title: '平均用户调用次数',
      explanation: '反应每天用户的使用次数。该指标反映了用户粘性。',
    },
    userSatisfactionRate: {
      title: '用户满意度',
      explanation: '每 1000 条消息的点赞数。反应了用户对回答十分满意的比例。',
    },
    avgResponseTime: {
      title: '平均响应时间',
      explanation: '衡量 AI 应用处理和回复用户请求所花费的平均时间，单位为毫秒，反映性能和用户体验。仅在文本型应用提供。',
    },
    tps: {
      title: 'Token 输出速度',
      explanation: '衡量 LLM 的性能。统计 LLM 从请求开始到输出完毕这段期间的 Tokens 输出速度。',
    },
  },
}

export default translation
