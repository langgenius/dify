const translation = {
  title: '召回测试',
  desc: '基于给定的查询文本测试知识库的召回效果。',
  dateTimeFormat: 'YYYY-MM-DD HH:mm',
  recents: '最近查询',
  table: {
    header: {
      source: '数据源',
      text: '文本',
      time: '时间',
    },
  },
  input: {
    title: '源文本',
    placeholder: '请输入文本，建议使用简短的陈述句。',
    countWarning: '不超过 200 个字符',
    indexWarning: '仅支持高质量模式知识库',
    testing: '测试',
  },
  hit: {
    title: '召回段落',
    emptyTip: '召回测试结果将展示在这里',
  },
  noRecentTip: '最近无查询结果',
  viewChart: '查看向量图表',
}

export default translation
