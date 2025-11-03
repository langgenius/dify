const translation = {
  creation: {
    backToKnowledge: '返回知识库',
    createFromScratch: {
      title: '空白知识流水线',
      description: '从零开始创建一个自定义知识流水线，对数据处理和结构拥有完全控制权。',
    },
    importDSL: '从 DSL 文件导入',
    createKnowledge: '创建知识流水线',
    errorTip: '创建知识流水线失败',
    successTip: '成功创建知识流水线',
    caution: '注意',
  },
  templates: {
    customized: '自定义',
  },
  operations: {
    choose: '选择',
    details: '详情',
    editInfo: '编辑信息',
    useTemplate: '使用此知识流水线',
    backToDataSource: '返回数据源',
    process: '处理',
    dataSource: '数据源',
    saveAndProcess: '保存并处理',
    preview: '预览',
    exportPipeline: '导出知识流水线',
    convert: '转换',
  },
  knowledgeNameAndIcon: '知识库名称和图标',
  knowledgeNameAndIconPlaceholder: '请输入知识库名称',
  knowledgeDescription: '知识库描述',
  knowledgeDescriptionPlaceholder: '描述知识库中的内容。详细的描述可以让 AI 更准确地访问数据集的内容。如果为空，Dify 将使用默认的命中策略。（可选）',
  knowledgePermissions: '权限',
  editPipelineInfo: '编辑知识流水线信息',
  pipelineNameAndIcon: '知识流水线名称和图标',
  deletePipeline: {
    title: '要删除此知识流水线模板吗？',
    content: '删除知识流水线模板是不可逆的。',
  },
  publishPipeline: {
    success: {
      message: '知识流水线发布成功',
      tip: '<CustomLink>前往文档</CustomLink>添加或管理文档。',
    },
    error: {
      message: '知识流水线发布失败',
    },
  },
  publishTemplate: {
    success: {
      message: '知识流水线模板发布成功',
      tip: '您可以在创建页使用该模板。',
      learnMore: '了解更多',
    },
    error: {
      message: '知识流水线模板发布失败',
    },
  },
  exportDSL: {
    successTip: '成功导出知识流水线 DSL',
    errorTip: '导出知识流水线 DSL 失败',
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
    description: '用户输入字段用于定义和收集知识流水线执行过程中所需的变量，用户可以自定义字段类型，并灵活配置输入，以满足不同数据源或文档处理的需求。',
    uniqueInputs: {
      title: '非共享输入',
      tooltip: '非共享输入只能被选定的数据源及其下游节点访问。用户在选择其他数据源时不需要填写它。只有数据源变量引用的输入字段才会出现在第一步（数据源）中。所有其他字段将在第二步（处理文档）中显示。',
    },
    globalInputs: {
      title: '全局共享输入',
      tooltip: '全局共享输入在所有节点之间共享。用户在选择任何数据源时都需要填写它们。例如，像分隔符和最大块长度这样的字段可以跨多个数据源统一应用。只有数据源变量引用的输入字段才会出现在第一步（数据源）中。所有其他字段都显示在第二步（处理文档）中。',
    },
    addInputField: '添加输入字段',
    editInputField: '编辑输入字段',
    preview: {
      stepOneTitle: '数据源',
      stepTwoTitle: '处理文档',
    },
    error: {
      variableDuplicate: '变量名已存在。请选择其他名称。',
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
    selectOnlineDocumentTip: '最多处理 {{count}} 页',
    selectOnlineDriveTip: '最多处理 {{count}} 个文件，每个文件最大 {{fileSize}} MB',
  },
  documentSettings: {
    title: '文档设置',
  },
  onlineDocument: {
    pageSelectorTitle: '{{name}} 页面',
  },
  onlineDrive: {
    notConnected: '{{name}} 未绑定',
    notConnectedTip: '同步 {{name}} 内容前, 须先绑定 {{name}}。',
    breadcrumbs: {
      allBuckets: '所有云存储桶',
      allFiles: '所有文件',
      searchResult: '在 "{{folderName}}" 文件夹中找到 {{searchResultsLength}} 个项目',
      searchPlaceholder: '搜索文件...',
    },
    notSupportedFileType: '不支持此文件类型',
    emptyFolder: '此文件夹为空',
    emptySearchResult: '未找到任何项目',
    resetKeywords: '重置关键词',
  },
  credentialSelector: {
    name: '{{credentialName}} 的 {{pluginName}}',
  },
  configurationTip: '配置 {{pluginName}}',
  conversion: {
    title: '转换为知识流水线',
    descriptionChunk1: '您现在可以将现有知识库转换为使用知识流水线来处理文档',
    descriptionChunk2: ' —— 这是一种更开放、更灵活的方式，可以访问我们市场中的插件。新的处理方式将应用到后续添加的所有文档。',
    warning: '此操作无法撤销。',
    confirm: {
      title: '确认',
      content: '此操作是永久性的。您将无法恢复到之前的方式。请确认转换。',
    },
    errorMessage: '转换数据集为知识流水线失败',
    successMessage: '成功将数据集转换为知识流水线',
  },
}

export default translation
