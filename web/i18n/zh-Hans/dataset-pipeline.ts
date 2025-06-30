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
    dataSource: '数据源',
    saveAndProcess: '保存并处理',
    preview: '预览',
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
    createdBy: '由 {{author}} 创建',
    structure: '文档结构',
    structureTooltip: '文档结构决定了文档的拆分和索引方式，Dify 提供了通用、父子和问答模式，每个知识库的文档结构是唯一的。',
  },
  testRun: {
    title: '测试运行',
    tooltip: '在测试运行模式下，每次只能导入一个文档，以便于调试和观察。',
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
    uniqueInputs: {
      title: '非共享输入',
      tooltip: '非共享输入只能被选定的数据源及其下游节点访问。用户在选择其他数据源时不需要填写它。只有数据源变量引用的输入字段才会出现在第一步（数据源）中。所有其他字段将在第二步（Process Documents）中显示。',
    },
    globalInputs: {
      title: '全局共享输入',
      tooltip: '全局共享输入在所有节点之间共享。用户在选择任何数据源时都需要填写它们。例如，像分隔符（delimiter）和最大块长度（Maximum Chunk Length）这样的字段可以跨多个数据源统一应用。只有数据源变量引用的输入字段才会出现在第一步（数据源）中。所有其他字段都显示在第二步（Process Documents）中。',
    },
    addInputField: '添加输入字段',
    editInputField: '编辑输入字段',
    preview: {
      stepOneTitle: '数据源',
      stepTwoTitle: '处理文档',
    },
  },
  addDocuments: {
    title: '添加文档',
    steps: {
      chooseDatasource: '选择数据源',
      processDocuments: '处理文档',
      processingDocuments: '正在处理文档',
    },
    backToDataSource: '数据源',
    stepOne: {
      preview: '预览',
    },
    stepTwo: {
      chunkSettings: '分段设置',
      previewChunks: '预览分段',
    },
    stepThree: {
      learnMore: '了解更多',
    },
    characters: '字符',
  },
  documentSettings: {
    title: '文档设置',
  },
  onlineDrive: {
    notConnected: '{{name}} 未绑定',
    notConnectedTip: '同步 {{name}} 内容前, 须先绑定 {{name}}。',
    breadcrumbs: {
      allBuckets: '所有云存储桶',
      searchResult: '在 "{{folderName}}" 文件夹中找到 {{searchResultsLength}} 个项目',
      noSearchResult: '未找到项目',
      resetKeywords: '重置关键词',
      searchPlaceholder: '搜索文件...',
    },
    notSupportedFileType: '不支持此文件类型',
  },
}

export default translation
