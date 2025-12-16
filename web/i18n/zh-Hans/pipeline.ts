const translation = {
  common: {
    goToAddDocuments: '去添加文档',
    publishAs: '发布为自定义流水线模板',
    confirmPublish: '确认发布',
    confirmPublishContent: '成功发布知识流水线后，此知识库的分段结构将无法修改。您确定要发布吗？',
    publishAsPipeline: {
      name: '知识流水线名称和图标',
      namePlaceholder: '请输入此知识流水线的名称。 (必填)',
      description: '知识流水线描述',
      descriptionPlaceholder: '请输入此知识流水线的描述。 (可选)',
    },
    testRun: '测试运行',
    preparingDataSource: '准备数据源',
    reRun: '重新运行',
    processing: '处理中',
  },
  inputField: {
    create: '创建用户输入字段',
    manage: '管理',
  },
  publishToast: {
    title: '此知识流水线尚未发布',
    desc: '当知识流水线未发布时，您可以修改知识库节点中的分块结构，知识流水线编排和更改将自动保存为草稿。',
  },
  result: {
    resultPreview: {
      loading: '处理中...请稍后',
      error: '执行过程中出现错误',
      viewDetails: '查看详情',
      footerTip: '在测试运行模式下，最多预览 {{count}} 个分段',
    },
  },
  ragToolSuggestions: {
    title: 'RAG 工具推荐',
    noRecommendationPlugins: '暂无推荐插件，更多插件请在 <CustomLink>Marketplace</CustomLink> 中查找',
  },
}

export default translation
