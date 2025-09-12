const translation = {
  title: '召回測試',
  desc: '基於給定的查詢文字測試知識庫的召回效果。',
  dateTimeFormat: 'YYYY-MM-DD HH:mm',
  table: {
    header: {
      source: '資料來源',
      text: '文字',
      time: '時間',
    },
  },
  input: {
    title: '源文字',
    placeholder: '請輸入文字，建議使用簡短的陳述句。',
    countWarning: '不超過 200 個字元',
    indexWarning: '僅支援高質量模式知識庫',
    testing: '測試',
  },
  hit: {
    title: '召回段落',
    emptyTip: '召回測試結果將展示在這裡',
  },
  noRecentTip: '最近無查詢結果',
  viewChart: '查看向量圖表',
  viewDetail: '查看詳情',
  settingTitle: '檢索設置',
  open: '打開',
  records: '記錄',
  chunkDetail: '數據塊詳細資訊',
  hitChunks: '命中 {{num}} 個子塊',
  keyword: '關鍵字',
}

export default translation
