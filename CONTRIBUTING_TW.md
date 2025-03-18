# 貢獻指南

您想為 Dify 做出貢獻 - 這太棒了，我們迫不及待地想看看您的成果。作為一家人力和資金有限的初創公司，我們有宏大的抱負，希望設計出最直觀的工作流程來構建和管理 LLM 應用程式。來自社群的任何幫助都非常珍貴，真的。

鑑於我們的現狀，我們需要靈活且快速地發展，但同時也希望確保像您這樣的貢獻者能夠獲得盡可能順暢的貢獻體驗。我們編寫了這份貢獻指南，目的是幫助您熟悉代碼庫以及我們如何與貢獻者合作，讓您可以更快地進入有趣的部分。

這份指南，就像 Dify 本身一樣，是不斷發展的。如果有時它落後於實際項目，我們非常感謝您的理解，也歡迎任何改進的反饋。

關於授權，請花一分鐘閱讀我們簡短的[授權和貢獻者協議](./LICENSE)。社群也遵守[行為準則](https://github.com/langgenius/.github/blob/main/CODE_OF_CONDUCT.md)。

## 在開始之前

[尋找](https://github.com/langgenius/dify/issues?q=is:issue+is:open)現有的 issue，或[創建](https://github.com/langgenius/dify/issues/new/choose)一個新的。我們將 issues 分為 2 種類型：

### 功能請求

- 如果您要開啟新的功能請求，我們希望您能解釋所提議的功能要達成什麼目標，並且盡可能包含更多的相關背景資訊。[@perzeusss](https://github.com/perzeuss) 已經製作了一個實用的[功能請求輔助工具](https://udify.app/chat/MK2kVSnw1gakVwMX)，能幫助您草擬您的需求。歡迎試用。

- 如果您想從現有問題中選擇一個來處理，只需在其下方留言表示即可。

  相關方向的團隊成員會加入討論。如果一切順利，他們會同意您開始編寫代碼。我們要求您在得到許可前先不要開始處理該功能，以免我們提出變更時您的工作成果被浪費。

  根據所提議功能的領域不同，您可能會與不同的團隊成員討論。以下是目前每位團隊成員所負責的領域概述：

  | 成員                                                                                    | 負責領域                       |
  | --------------------------------------------------------------------------------------- | ------------------------------ |
  | [@yeuoly](https://github.com/Yeuoly)                                                    | 設計 Agents 架構               |
  | [@jyong](https://github.com/JohnJyong)                                                  | RAG 管道設計                   |
  | [@GarfieldDai](https://github.com/GarfieldDai)                                          | 建構工作流程編排               |
  | [@iamjoel](https://github.com/iamjoel) & [@zxhlyh](https://github.com/zxhlyh)           | 打造易用的前端界面             |
  | [@guchenhe](https://github.com/guchenhe) & [@crazywoola](https://github.com/crazywoola) | 開發者體驗，各類問題的聯絡窗口 |
  | [@takatost](https://github.com/takatost)                                                | 整體產品方向與架構             |

  我們如何排定優先順序：

  | 功能類型                                                                                                | 優先級   |
  | ------------------------------------------------------------------------------------------------------- | -------- |
  | 被團隊成員標記為高優先級的功能                                                                          | 高優先級 |
  | 來自我們[社群回饋版](https://github.com/langgenius/dify/discussions/categories/feedbacks)的熱門功能請求 | 中優先級 |
  | 非核心功能和次要增強                                                                                    | 低優先級 |
  | 有價值但非急迫的功能                                                                                    | 未來功能 |

### 其他事項 (例如錯誤回報、效能優化、錯字更正)

- 可以直接開始編寫程式碼。

  我們如何排定優先順序：

  | 問題類型                                              | 優先級   |
  | ----------------------------------------------------- | -------- |
  | 核心功能的錯誤 (無法登入、應用程式無法運行、安全漏洞) | 重要     |
  | 非關鍵性錯誤、效能提升                                | 中優先級 |
  | 小修正 (錯字、令人困惑但仍可運作的使用者界面)         | 低優先級 |

## 安裝

以下是設置 Dify 開發環境的步驟：

### 1. 分叉此存儲庫

### 2. 複製代碼庫

從您的終端機複製分叉的代碼庫：

```shell
git clone git@github.com:<github_username>/dify.git
```

- [Docker](https://www.docker.com/)
- [Docker Compose](https://docs.docker.com/compose/install/)
- [Node.js v18.x (LTS)](http://nodejs.org)
- [pnpm](https://pnpm.io/)
- [Python](https://www.python.org/) version 3.11.x or 3.12.x

### 4. 安裝

Dify 由後端和前端組成。透過 `cd api/` 導航至後端目錄，然後按照[後端 README](api/README.md)進行安裝。在另一個終端機視窗中，透過 `cd web/` 導航至前端目錄，然後按照[前端 README](web/README.md)進行安裝。

查閱[安裝常見問題](https://docs.dify.ai/learn-more/faq/install-faq)了解常見問題和故障排除步驟的列表。

### 5. 在瀏覽器中訪問 Dify

要驗證您的設置，請在瀏覽器中訪問 [http://localhost:3000](http://localhost:3000)（預設值，或您自行設定的 URL 和埠號）。現在您應該能看到 Dify 已啟動並運行。

## 開發

如果您要添加模型提供者，請參考[此指南](https://github.com/langgenius/dify/blob/main/api/core/model_runtime/README.md)。

如果您要為 Agent 或工作流程添加工具提供者，請參考[此指南](./api/core/tools/README.md)。

為了幫助您快速找到您的貢獻適合的位置，以下是 Dify 後端和前端的簡要註解大綱：

### 後端

Dify 的後端使用 Python 的 [Flask](https://flask.palletsprojects.com/en/3.0.x/) 框架編寫。它使用 [SQLAlchemy](https://www.sqlalchemy.org/) 作為 ORM 工具，使用 [Celery](https://docs.celeryq.dev/en/stable/getting-started/introduction.html) 進行任務佇列處理。授權邏輯則透過 Flask-login 實現。

```text
[api/]
├── constants             // 整個專案中使用的常數與設定值
├── controllers           // API 路由定義與請求處理邏輯
├── core                  // 核心應用服務、模型整合與工具實現
├── docker                // Docker 容器化相關設定檔案
├── events                // 事件處理與流程管理機制
├── extensions            // 與第三方框架或平台的整合擴充功能
├── fields                // 資料序列化與結構定義欄位
├── libs                  // 可重複使用的共用程式庫與輔助工具
├── migrations            // 資料庫結構變更與遷移腳本
├── models                // 資料庫模型與資料結構定義
├── services              // 核心業務邏輯與功能實現
├── storage               // 私鑰與敏感資訊儲存機制
├── tasks                 // 非同步任務與背景作業處理器
└── tests
```

### 前端

網站基於 [Next.js](https://nextjs.org/) 的 Typescript 樣板，並使用 [Tailwind CSS](https://tailwindcss.com/) 進行樣式設計。[React-i18next](https://react.i18next.com/) 用於國際化。

```text
[web/]
├── app                   // 頁面佈局與介面元件
│   ├── (commonLayout)    // 應用程式共用佈局結構
│   ├── (shareLayout)     // Token 會話專用共享佈局
│   ├── activate          // 帳號啟用頁面
│   ├── components        // 頁面與佈局共用元件
│   ├── install           // 系統安裝頁面
│   ├── signin            // 使用者登入頁面
│   └── styles            // 全域共用樣式定義
├── assets                // 靜態資源檔案庫
├── bin                   // 建構流程執行腳本
├── config                // 系統可調整設定與選項
├── context               // 應用程式狀態共享上下文
├── dictionaries          // 多語系翻譯詞彙庫
├── docker                // Docker 容器設定檔
├── hooks                 // 可重複使用的 React Hooks
├── i18n                  // 國際化與本地化設定
├── models                // 資料結構與 API 回應模型
├── public                // 靜態資源與網站圖標
├── service               // API 操作介面定義
├── test                  // 測試用例與測試框架
├── types                 // TypeScript 型別定義
└── utils                 // 共用輔助功能函式庫
```

## 提交您的 PR

最後，是時候向我們的存儲庫開啟拉取請求（PR）了。對於主要功能，我們會先將它們合併到 `deploy/dev` 分支進行測試，然後才會進入 `main` 分支。如果您遇到合併衝突或不知道如何開啟拉取請求等問題，請查看 [GitHub 的拉取請求教學](https://docs.github.com/en/pull-requests/collaborating-with-pull-requests)。

就是這樣！一旦您的 PR 被合併，您將作為貢獻者出現在我們的 [README](https://github.com/langgenius/dify/blob/main/README.md) 中。

## 獲取幫助

如果您在貢獻過程中遇到困難或有迫切的問題，只需通過相關的 GitHub issue 向我們提問，或加入我們的 [Discord](https://discord.gg/8Tpq4AcN9c) 進行快速交流。
