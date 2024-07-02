const translation = {
  knowledge: '知識庫',
  documentCount: ' 文件',
  wordCount: ' 千字元',
  appCount: ' 關聯應用',
  createDataset: '建立知識庫',
  createDatasetIntro: '匯入您自己的文字資料或透過 Webhook 實時寫入資料以增強 LLM 的上下文。',
  deleteDatasetConfirmTitle: '要刪除知識庫嗎？',
  deleteDatasetConfirmContent:
    '刪除知識庫是不可逆的。使用者將無法再訪問您的知識庫,所有的提示配置和日誌將被永久刪除。',
  datasetUsedByApp: '這些知識正被一些應用程序使用。應用程序將無法再使用這些知識，所有提示配置和日誌將被永久刪除。',
  datasetDeleted: '知識庫已刪除',
  datasetDeleteFailed: '刪除知識庫失敗',
  didYouKnow: '你知道嗎？',
  intro1: '知識庫可以被整合到 Dify 應用中',
  intro2: '作為上下文',
  intro3: ',',
  intro4: '或可以',
  intro5: '建立',
  intro6: '為獨立的 ChatGPT 外掛釋出使用',
  unavailable: '不可用',
  unavailableTip: '由於 embedding 模型不可用，需要配置預設 embedding 模型',
  datasets: '知識庫',
  datasetsApi: 'API',
  retrieval: {
    semantic_search: {
      title: '向量檢索',
      description: '透過生成查詢嵌入並查詢與其向量表示最相似的文字分段',
    },
    full_text_search: {
      title: '全文檢索',
      description: '索引文件中的所有詞彙，從而允許使用者查詢任意詞彙，並返回包含這些詞彙的文字片段',
    },
    hybrid_search: {
      title: '混合檢索',
      description: '同時執行全文檢索和向量檢索，並應用重排序步驟，從兩類查詢結果中選擇匹配使用者問題的最佳結果，需配置 Rerank 模型 API',
      recommend: '推薦',
    },
    invertedIndex: {
      title: '倒排索引',
      description: '倒排索引是一種用於高效檢索的結構。按術語組織，每個術語指向包含它的文件或網頁',
    },
    change: '更改',
    changeRetrievalMethod: '更改檢索方法',
  },
  docsFailedNotice: '文件無法被索引',
  retry: '重試',
}

export default translation
