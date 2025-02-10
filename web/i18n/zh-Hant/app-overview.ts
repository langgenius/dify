const translation = {
  welcome: {
    firstStepTip: '開始之前,',
    enterKeyTip: '請先在下方輸入你的 OpenAI API Key',
    getKeyTip: '從 OpenAI 獲取你的 API Key',
    placeholder: '你的 OpenAI API Key（例如 sk-xxxx）',
  },
  apiKeyInfo: {
    cloud: {
      trial: {
        title: '您正在使用 {{providerName}} 的試用配額。',
        description: '試用配額僅供您測試使用。 在試用配額用完之前，請自行設定模型提供商或購買額外配額。',
      },
      exhausted: {
        title: '您的試用額度已用完，請設定您的APIKey。',
        description: '您的試用配額已用完。 請設定您自己的模型提供商或購買額外配額。',
      },
    },
    selfHost: {
      title: {
        row1: '首先，',
        row2: '設定您的模型提供商。',
      },
    },
    callTimes: '呼叫次數',
    usedToken: '使用 Tokens',
    setAPIBtn: '設定模型提供商',
    tryCloud: '或者嘗試使用 Dify 的雲版本並使用試用配額',
  },
  overview: {
    title: '概覽',
    appInfo: {
      explanation: '開箱即用的 AI WebApp',
      accessibleAddress: '公開訪問 URL',
      preview: '預覽',
      regenerate: '重新生成',
      regenerateNotice: '您是否要重新生成公開訪問 URL？',
      preUseReminder: '使用前請先開啟開關',
      settings: {
        entry: '設定',
        title: 'WebApp 設定',
        webName: 'WebApp 名稱',
        webDesc: 'WebApp 描述',
        webDescTip: '以下文字將展示在客戶端中，對應用進行說明和使用上的基本引導',
        webDescPlaceholder: '請輸入 WebApp 的描述',
        language: '語言',
        workflow: {
          title: '工作流程步驟',
          show: '展示',
          hide: '隱藏',
          subTitle: '工作流詳細資訊',
          showDesc: '在 WebApp 中顯示或隱藏工作流詳細資訊',
        },
        chatColorTheme: '聊天顏色主題',
        chatColorThemeDesc: '設定聊天機器人的顏色主題',
        chatColorThemeInverted: '反轉',
        invalidHexMessage: '無效的十六進制值',
        more: {
          entry: '展示更多設定',
          copyright: '版權',
          copyRightPlaceholder: '請輸入作者或組織名稱',
          privacyPolicy: '隱私政策',
          privacyPolicyPlaceholder: '請輸入隱私政策連結',
          privacyPolicyTip: '幫助訪問者瞭解該應用收集的資料，可參考 Dify 的<privacyPolicyLink>隱私政策</privacyPolicyLink>。',
          customDisclaimer: '自定義免責聲明',
          customDisclaimerPlaceholder: '請輸入免責聲明',
          customDisclaimerTip: '客製化的免責聲明文字將在客戶端顯示，提供有關應用程式的額外資訊。',
          copyrightTip: '在 Web 應用程式中顯示版權資訊',
          copyrightTooltip: '請升級至專業計劃或以上',
        },
        sso: {
          description: '所有使用者在使用 WebApp 之前都需要使用 SSO 登錄',
          title: 'WebApp SSO',
          tooltip: '聯繫管理員以啟用 WebApp SSO',
          label: 'SSO 身份驗證',
        },
        modalTip: '用戶端 Web 應用程式設置。',
      },
      embedded: {
        entry: '嵌入',
        title: '嵌入到網站中',
        explanation: '選擇一種方式將聊天應用嵌入到你的網站中',
        iframe: '將以下 iframe 嵌入到你的網站中的目標位置',
        scripts: '將以下程式碼嵌入到你的網站中',
        chromePlugin: '安裝 Dify Chrome 瀏覽器擴充套件',
        copied: '已複製',
        copy: '複製',
      },
      qrcode: {
        title: '二維碼分享',
        scan: '掃碼分享應用',
        download: '下載二維碼',
      },
      customize: {
        way: '方法',
        entry: '定製化',
        title: '定製化 AI WebApp',
        explanation: '你可以定製化 Web App 前端以符合你的情景與風格需求',
        way1: {
          name: 'Fork 客戶端程式碼修改後部署到 Vercel（推薦）',
          step1: 'Fork 客戶端程式碼並修改',
          step1Tip: '點選此處 Fork 原始碼到你的 GitHub 中，然後修改程式碼',
          step1Operation: 'Dify-WebClient',
          step2: '部署到 Vercel 中',
          step2Tip: '點選此處將倉庫匯入到 Vercel 中部署',
          step2Operation: '匯入倉庫',
          step3: '配置環境變數',
          step3Tip: '在 Vecel 環境變數中新增以下環境變數',
        },
        way2: {
          name: '編寫客戶端呼叫 API 並部署到伺服器中',
          operation: '檢視文件',
        },
      },
      launch: '發射',
    },
    apiInfo: {
      title: '後端服務 API',
      explanation: '可整合至你的應用的後端即服務',
      accessibleAddress: 'API 訪問憑據',
      doc: '查閱 API 文件',
    },
    status: {
      running: '執行中',
      disable: '已停用',
    },
  },
  analysis: {
    title: '分析',
    ms: '毫秒',
    tokenPS: 'Token/秒',
    totalMessages: {
      title: '全部訊息數',
      explanation: '反映 AI 每天的互動總次數，每回答使用者一個問題算一條 Message。提示詞編排和除錯的訊息不計入。',
    },
    activeUsers: {
      title: '活躍使用者數',
      explanation: '每日AI互動次數。',
    },
    totalConversations: {
      title: '總對話數',
      explanation: '每日AI對話次數；不包括提示工程/調試。',
    },
    tokenUsage: {
      title: '費用消耗',
      explanation: '反映每日該應用請求語言模型的 Tokens 花費，用於成本控制。',
      consumed: '耗費',
    },
    avgSessionInteractions: {
      title: '平均會話互動數',
      explanation: '反應每個會話使用者的持續溝通次數，如果使用者與 AI 問答了 10 輪，即為 10。該指標反映了使用者粘性。僅在對話型應用提供。',
    },
    avgUserInteractions: {
      title: '平均使用者呼叫次數',
      explanation: '反應每天使用者的使用次數。該指標反映了使用者粘性。',
    },
    userSatisfactionRate: {
      title: '使用者滿意度',
      explanation: '每 1000 條訊息的點贊數。反應了使用者對回答十分滿意的比例。',
    },
    avgResponseTime: {
      title: '平均響應時間',
      explanation: '衡量 AI 應用處理和回覆使用者請求所花費的平均時間，單位為毫秒，反映效能和使用者體驗。僅在文字型應用提供。',
    },
    tps: {
      title: 'Token 輸出速度',
      explanation: '衡量 LLM 的效能。統計 LLM 從請求開始到輸出完畢這段期間的 Tokens 輸出速度。',
    },
  },
}

export default translation
