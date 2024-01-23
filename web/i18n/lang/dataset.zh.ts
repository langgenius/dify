const translation = {
  knowledge: '知识库',
  documentCount: ' 文档',
  wordCount: '千字符',
  appCount: ' 关联应用',
  createDataset: '创建知识库',
  createDatasetIntro: '导入您自己的文本数据或通过 Webhook 实时写入数据以增强 LLM 的上下文。',
  deleteDatasetConfirmTitle: '要删除知识库吗？',
  deleteDatasetConfirmContent:
    '删除知识库是不可逆的。用户将无法再访问您的知识库,所有的提示配置和日志将被永久删除。',
  datasetDeleted: '知识库已删除',
  datasetDeleteFailed: '删除知识库失败',
  didYouKnow: '你知道吗？',
  intro1: '知识库可以被集成到 Dify 应用中',
  intro2: '作为上下文',
  intro3: ',',
  intro4: '或可以',
  intro5: '创建',
  intro6: '为独立的 ChatGPT 插件发布使用',
  unavailable: '不可用',
  unavailableTip: '由于 embedding 模型不可用，需要配置默认 embedding 模型',
  datasets: '知识库',
  datasetsApi: 'API',
  retrieval: {
    semantic_search: {
      title: '向量检索',
      description: '通过生成查询嵌入并查询与其向量表示最相似的文本分段',
    },
    full_text_search: {
      title: '全文检索',
      description: '索引文档中的所有词汇，从而允许用户查询任意词汇，并返回包含这些词汇的文本片段',
    },
    hybrid_search: {
      title: '混合检索',
      description: '同时执行全文检索和向量检索，并应用重排序步骤，从两类查询结果中选择匹配用户问题的最佳结果，需配置 Rerank 模型 API',
      recommend: '推荐',
    },
    invertedIndex: {
      title: '倒排索引',
      description: '倒排索引是一种用于高效检索的结构。按术语组织，每个术语指向包含它的文档或网页',
    },
    change: '更改',
    changeRetrievalMethod: '更改检索方法',
  },
}

export default translation
