const translation = {
  welcome: {
    firstStepTip: '开始之前,',
    enterKeyTip: '请先在下方输入你的 OpenAI API Key',
    getKeyTip: '从 OpenAI 获取你的 API Key',
    placeholder: '你的 OpenAI API Key（例如 sk-xxxx）',
  },
  overview: {
    title: '概览',
    appInfo: {
      explanation: '开箱即用的 AI WebApp',
      accessibleAddress: '公开访问 URL',
      preview: '预览',
      share: {
        entry: '分享',
        explanation: '将以下网址分享出去，让更多人访问该应用',
        shareUrl: '分享 URL',
        copyLink: '复制链接',
        regenerate: '重新生成',
      },
      preUseReminder: '使用前请先打开开关',
      settings: {
        entry: '设置',
        title: 'WebApp 设置',
        webName: 'WebApp 名称',
        webDesc: 'WebApp 描述',
        webDescTip: '以下文字将展示在客户端中，对应用进行说明和使用上的基本引导',
        webDescPlaceholder: '请输入 WebApp 的描述',
        language: '语言',
        more: {
          entry: '展示更多设置',
          copyright: '版权',
          copyRightPlaceholder: '请输入作者或组织名称',
          privacyPolicy: '隐私政策',
          privacyPolicyPlaceholder: '请输入隐私政策',
          privacyPolicyTip: '帮助访问者了解该应用收集的数据，可参考 Dify 的<privacyPolicyLink>隐私政策</privacyPolicyLink>。',
        },
      },
      customize: {
        way: '方法',
        entry: '想要进一步自定义 WebApp？',
        title: '定制化 AI WebApp',
        explanation: '你可以定制化 Web App 前端以符合你的情景与风格需求',
        way1: {
          name: 'Fork 客户端代码修改后部署到 Vercel（推荐）',
          step1: 'Fork 客户端代码并修改',
          step1Tip: '点击此处 Fork 源码到你的 GitHub 中，然后修改代码',
          step1Operation: 'Dify-WebClient',
          step2: '配置 Web APP',
          step2Tip: '复制 Web API 秘钥 和 APP ID 拷贝到客户端代码 config/index.ts 中',
          step3: '部署到 Vercel 中',
          step3Tip: '点击此处将仓库导入到 Vercel 中部署',
          step3Operation: '导入仓库',
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
    totalMessages: {
      title: '全部消息数',
      explanation: '反映 AI 每天的互动总次数，每回答用户一个问题算一条 Message。提示词编排和调试的消息不计入。',
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
    userSatisfactionRate: {
      title: '用户满意度',
      explanation: '每 1000 条消息的点赞数。反应了用户对回答十分满意的比例。',
    },
    avgResponseTime: {
      title: '平均响应时间',
      explanation: '衡量 AI 应用处理和回复用户请求所花费的平均时间，单位为毫秒，反映性能和用户体验。仅在文本型应用提供。',
    },
  },
}

export default translation
