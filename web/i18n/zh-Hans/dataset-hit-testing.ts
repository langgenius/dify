const translation = {
  title: '召回测试',
  settingTitle: '召回设置',
  desc: '根据给定的查询文本测试知识的召回效果。',
  dateTimeFormat: 'YYYY-MM-DD HH:mm',
  records: '记录',
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
    title: '{{num}} 个召回段落',
    emptyTip: '召回测试结果将展示在这里',
  },
  noRecentTip: '最近无查询结果',
  viewChart: '查看向量图表',
  viewDetail: '查看详情',
  chunkDetail: '段落详情',
  hitChunks: '命中 {{num}} 个子段落',
  open: '打开',
  keyword: '关键词',
}

export default translation
