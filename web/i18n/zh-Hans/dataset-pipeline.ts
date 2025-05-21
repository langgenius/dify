const translation = {
  creation: {
    title: '创建知识库流水线',
    createFromScratch: {
      title: '从零开始创建',
      description: '空白知识库流水线',
    },
    ImportDSL: {
      title: '导入',
      description: '从 DSL 文件导入',
    },
    createKnowledge: '创建知识库',
    errorTip: '创建知识库流水线失败',
    successTip: '成功创建知识库流水线',
  },
  tabs: {
    builtInPipeline: '内置流水线',
    customized: '自定义',
  },
  operations: {
    choose: '选择',
    details: '详情',
    editInfo: '编辑信息',
    exportDSL: '导出 DSL',
    useTemplate: '使用此知识库流水线',
    backToDataSource: '返回数据源',
    process: '处理',
  },
  knowledgeNameAndIcon: '知识库名称和图标',
  knowledgeNameAndIconPlaceholder: '请输入知识库名称',
  knowledgeDescription: '知识库描述',
  knowledgeDescriptionPlaceholder: '描述知识库中的内容。详细的描述可以让 AI 更准确地访问数据集的内容。如果为空，Dify 将使用默认的命中策略。（可选）',
  knowledgePermissions: '权限',
  editPipelineInfo: '编辑流水线信息',
  pipelineNameAndIcon: '流水线名称和图标',
  deletePipeline: {
    title: '要删除此流水线模板吗？',
    content: '删除流水线模板是不可逆的。',
  },
  exportDSL: {
    successTip: '成功导出流水线 DSL',
    errorTip: '导出流水线 DSL 失败',
  },
  details: {
    structure: '文档结构',
    structureTooltip: '文档结构决定了文档的拆分和索引方式，Dify 提供了通用、父子和问答模式，每个知识库的文档结构是唯一的。',
  },
  testRun: {
    title: '测试运行',
    steps: {
      dataSource: '数据源',
      documentProcessing: '文档处理',
    },
    dataSource: {
      localFiles: '本地文件',
    },
    notion: {
      title: '选择 Notion 页面',
      docTitle: 'Notion 文档',
    },
  },
  inputField: '输入字段',
  inputFieldPanel: {
    title: '用户输入字段',
    description: '用户输入字段用于定义和收集流水线执行过程中所需的变量，用户可以自定义字段类型，并灵活配置输入，以满足不同数据源或文档处理的需求。',
    sharedInputs: {
      title: '共享输入',
      tooltip: '共享输入可被数据源中的所有下游节点使用。例如，在处理来自多个来源的文档时，delimiter（分隔符）和 maximum chunk length（最大分块长度）等变量可以统一应用。',
    },
    addInputField: '添加输入字段',
    editInputField: '编辑输入字段',
  },
  addDocuments: {
    title: '添加文档',
    steps: {
      chooseDatasource: '选择数据源',
      processDocuments: '处理文档',
      processingDocuments: '正在处理文档',
    },
    backToDataSource: '数据源',
  },
}

export default translation
