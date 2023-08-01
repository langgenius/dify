const translation = {
  title: '我的应用',
  sidebar: {
    discovery: '发现',
    chat: '智聊',
    workspace: '工作区',
    action: {
      pin: '置顶',
      unpin: '取消置顶',
      delete: '删除',
    },
    delete: {
      title: '删除程序',
      content: '您确定要删除此程序吗？',
    },
  },
  apps: {
    title: '探索 Dify 的应用',
    description: '使用这些模板应用程序，或根据模板自定义您自己的应用程序。',
    allCategories: '所有类别',
  },
  appCard: {
    addToWorkspace: '添加到工作区',
    customize: '自定义',
  },
  appCustomize: {
    title: '从 {{name}} 创建应用程序',
    subTitle: '应用程序图标和名称',
    nameRequired: '应用程序名称不能为空',
  },
  category: {
    Assistant: '助手',
    Writing: '写作',
    Translate: '翻译',
    Programming: '编程',
    HR: '人力资源',
  },
  universalChat: {
    welcome: '开始和 Dify 聊天吧',
    welcomeDescribe: '您的 AI 对话伴侣，为您提供个性化的帮助',
    model: '模型',
    plugins: {
      name: '插件',
      google_search: {
        name: '谷歌搜索',
        more: {
          left: '启用插件，首先',
          link: '设置您的 SerpAPI 密钥',
          right: '',
        },
      },
      web_reader: {
        name: '解析链接',
        description: '从任何网页链接获取所需信息',
      },
      wikipedia: {
        name: '维基百科',
      },
    },
    thought: {
      show: '显示',
      hide: '隐藏',
      processOfThought: '思考过程',
      res: {
        webReader: {
          normal: '解析链接 {url}',
          hasPageInfo: '解析链接 {url} 的下一页',
        },
        google: '搜索谷歌 {{query}}',
        wikipedia: '搜索维基百科 {{query}}',
        dataset: '检索数据集 {datasetName}',
        date: '查询日期',
      },
    },
    viewConfigDetailTip: '在对话中，无法更改上述设置',
  },
}

export default translation
