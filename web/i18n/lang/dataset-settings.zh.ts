const translation = {
  title: '数据集设置',
  desc: '在这里您可以修改数据集的工作方式以及其它设置。',
  form: {
    name: '数据集名称',
    nameError: '名称不能为空',
    desc: '数据集描述',
    descPlaceholder: '描述这个数据集中的内容。详细的描述可以让 AI 及时访问数据集的内容。如果为空，Dify 将使用默认的命中策略。',
    descWrite: '了解如何编写更好的数据集描述。',
    permissions: '可见权限',
    permissionsOnlyMe: '只有我',
    permissionsAllMember: '所有团队成员',
    indexMethod: '索引模式',
    indexMethodHighQuality: '高质量',
    indexMethodHighQualityTip: '调用 OpenAI 的嵌入接口进行处理，以在用户查询时提供更高的准确度',
    indexMethodEconomy: '经济',
    indexMethodEconomyTip: '使用离线的向量引擎、关键词索引等方式，降低了准确度但无需花费 Token',
    save: '保存',
  },
}

export default translation
