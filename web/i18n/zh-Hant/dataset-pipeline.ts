const translation = {
  creation: {
    createFromScratch: {
      title: '空白知識流水線',
      description: '從頭開始建立自訂流水線，並完全控制資料處理和結構。',
    },
    caution: '小心',
    backToKnowledge: '返回知識',
    errorTip: '無法建立知識庫',
    successTip: '成功建立知識庫',
    createKnowledge: '創造知識',
    importDSL: '從 DSL 檔案匯入',
  },
  templates: {
    customized: '客製化',
  },
  operations: {
    convert: '轉換',
    saveAndProcess: '儲存和處理',
    choose: '選擇',
    useTemplate: '使用此知識流水線',
    dataSource: '資料來源',
    editInfo: '編輯資訊',
    process: '處理',
    backToDataSource: '返回資料來源',
    exportPipeline: '匯出流水線',
    details: '詳情',
    preview: '預覽',
  },
  deletePipeline: {
    title: '您確定要刪除此管線範本嗎？',
    content: '刪除管線範本是不可逆的。',
  },
  publishPipeline: {
    success: {
      message: '知識流水線已發布',
    },
    error: {
      message: '無法發佈知識流水線',
    },
  },
  publishTemplate: {
    success: {
      message: '流水線範本已發佈',
      tip: '您可以在建立頁面上使用此範本。',
      learnMore: '瞭解詳情',
    },
    error: {
      message: '無法發佈管線範本',
    },
  },
  exportDSL: {
    errorTip: '無法匯出管線 DSL',
    successTip: '成功匯出管線 DSL',
  },
  details: {
    structureTooltip: '區塊結構會決定文件的分割和索引方式 （提供一般、父子和問答模式），而且每個知識庫都是唯一的。',
    structure: '建築物',
  },
  testRun: {
    steps: {
      documentProcessing: '文件處理',
      dataSource: '資料來源',
    },
    dataSource: {
      localFiles: '本機檔案',
    },
    notion: {
      docTitle: '概念文件',
      title: '選擇 Notion 頁面',
    },
    tooltip: '在測試運行模式下，一次只允許匯入一個文檔，以便於調試和觀察。',
    title: '試運行',
  },
  inputFieldPanel: {
    uniqueInputs: {
      title: '每個入口的獨特輸入',
      tooltip: '唯一輸入只能存取選取的資料來源及其下游節點。使用者在選擇其他資料來源時無需填寫。只有資料來源變數引用的輸入欄位才會出現在第一步（資料來源）中。所有其他欄位將顯示在第二步（處理文件）中。',
    },
    globalInputs: {
      title: '所有入口的全域輸入',
      tooltip: '全域輸入在所有節點之間共用。用戶在選擇任何數據源時需要填寫它們。例如，分隔符號和最大區塊長度等欄位可以統一套用至多個資料來源。只有資料來源變數所參考的輸入欄位才會出現在第一個步驟 （資料來源） 中。所有其他欄位都會顯示在第二個步驟 （處理文件） 中。',
    },
    preview: {
      stepOneTitle: '資料來源',
      stepTwoTitle: '處理文件',
    },
    error: {
      variableDuplicate: '變數名稱已存在。請選擇其他名稱。',
    },
    editInputField: '編輯輸入欄位',
    title: '使用者輸入欄位',
    addInputField: '新增輸入欄位',
    description: '使用者輸入欄位可用來定義和收集管線執行過程中所需的變數。使用者可以自訂欄位類型，靈活配置輸入值，以滿足不同資料來源或文件處理步驟的需求。',
  },
  addDocuments: {
    steps: {
      processingDocuments: '處理文件',
      processDocuments: '處理文件',
      chooseDatasource: '選擇資料來源',
    },
    stepOne: {
      preview: '預展',
    },
    stepTwo: {
      previewChunks: '預覽區塊',
      chunkSettings: '區塊設定',
    },
    stepThree: {
      learnMore: '瞭解詳情',
    },
    title: '新增文件',
    characters: '角色',
    backToDataSource: '資料來源',
  },
  documentSettings: {
    title: '文件設定',
  },
  onlineDocument: {},
  onlineDrive: {
    breadcrumbs: {
      allBuckets: '所有雲端儲存貯體',
      searchPlaceholder: '搜尋檔案...',
      allFiles: '所有檔案',
    },
    resetKeywords: '重設關鍵字',
    notSupportedFileType: '不支援此檔案類型',
    emptySearchResult: '沒有找到任何物品',
    emptyFolder: '此資料夾是空的',
  },
  credentialSelector: {},
  conversion: {
    confirm: {
      title: '證實',
      content: '此動作是永久性的。您將無法恢復到以前的方法。請確認轉換。',
    },
    title: '轉換為知識流水線',
    warning: '此動作無法復原。',
    descriptionChunk2: '— 一種更開放和靈活的方法，可以訪問我們市場中的插件。這會將新的處理方法套用至所有未來的文件。',
    successMessage: '已成功將資料集轉換成流水線',
    errorMessage: '無法將資料集轉換成流水線',
    descriptionChunk1: '您現在可以轉換現有的知識庫，以使用知識流水線進行文件處理',
  },
  knowledgeDescription: '知識說明',
  knowledgeNameAndIconPlaceholder: '請輸入知識庫的名稱',
  knowledgeDescriptionPlaceholder: '描述此知識庫中的內容。詳細的描述使人工智慧能夠更準確地存取資料集的內容。如果為空，Dify 將使用預設命中策略。（選用）',
  pipelineNameAndIcon: '流水線名稱 & 圖示',
  knowledgeNameAndIcon: '知識名稱和圖示',
  inputField: '輸入欄位',
  knowledgePermissions: '權限',
  editPipelineInfo: '編輯管線資訊',
}

export default translation
