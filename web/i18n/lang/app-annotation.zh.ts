const translation = {
  title: '标注',
  editBy: '{{author}}编辑的答案',
  noData: {
    title: '没有标注',
    description: '没有标注数据',
  },
  table: {
    header: {
      question: '问题',
      answer: '答案',
      createdAt: '创建时间',
      hits: '命中次数',
      actions: '操作',
      addAnnotation: '添加标注',
      bulkImport: '批量导入',
      bulkExport: '批量导出',
      clearAll: '删除所有标注',
    },
  },
  editModal: {
    title: '编辑标注回复',
    queryName: '用户提问',
    answerName: '机器回复',
    yourAnswer: '您的回复',
    answerPlaceholder: '在这里输入您的回复',
    yourQuery: '您的提问',
    queryPlaceholder: '在这里输入您的提问',
    removeThisCache: '删除此标注',
    createdAt: '创建于',
  },
  addModal: {
    title: '添加标注回复',
    queryName: '提问',
    answerName: '回复',
    answerPlaceholder: '输入回复',
    queryPlaceholder: '输入提问',
    createNext: '添加下一个标注回复',
  },
  errorMessage: {
    answerRequired: '回复不能为空',
    queryRequired: '提问不能为空',
  },
  viewModal: {
    annotatedResponse: '标注回复',
    hitHistory: '命中历史',
    hit: '次命中',
    hits: '次命中',
    noHitHistory: '没有命中历史',
  },
  hitHistoryTable: {
    question: '问题',
    source: '来源',
    score: '分数',
    time: '时间',
  },
  initSetup: {
    title: '标注回复初始设置',
    configTitle: '标注回复设置',
    confirmBtn: '保存并启用',
    configConfirmBtn: '保存',
  },
}

export default translation
