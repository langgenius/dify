# Feature: AI SDK Gateway Implementation

## Feature ID

`ai-sdk-gateway-core`

## Owner

luluwen

## Status

- [x] Draft
- [ ] Ready for implementation
- [ ] In review
- [ ] Approved
- [ ] Merged

---

## Goal

建構一個獨立的 **Gateway 層** 作為 AI SDK 的後端中樞，將標準 OpenAI Compatible API 請求翻譯並路由至對應的 Dify App 實例，實現多租戶隔離與動態模型切換。

## Non-goals

- 本次不做複雜的 Web UI 供客戶管理 Key（暫以配置檔或簡易資料庫處理）。
- 不處理跨 Region 的數據同步。
- 不實作底層模型推論（由 Dify/vLLM 處理）。

## User Story / 使用情境
As a 第三方應用開發者
I want 透過一組與 OpenAI 相容的 SDK 介面直接存取 AI 能力
So that 我不需要理解 Dify 的內部 Workflow 實作，且能快速切換不同底層模型與知識庫。

## Requirements

- [ ] **R1: OpenAI 協議相容**：實現 `POST /v1/chat/completions`、`GET /v1/models`、`POST /v1/datasets` 接口。
- [ ] **R2: 客戶路由 (Routing)**：解析 SDK Key，從 `CUSTOMER_REGISTRY` 映射至對應 Dify 的 `API_URL` 與 `App_Key`。
- [ ] **R3: 參數翻譯與覆蓋 (Override)**：
    - 將 OpenAI `messages` 轉為 Dify `query`。
    - 若 `extra_body` 包含 `llm_model`，需動態覆蓋 Dify 的 `model_config` 以實現模型切換。
- [ ] **R4: SSE 串流轉換**：將 Dify 的 SSE 事件流即時轉換為標準 OpenAI `chat.completion.chunk` 格式。
- [ ] **R5: 知識庫管理封裝**：將 `POST /v1/files` 轉接至 Dify Dataset 介面，並支援在建立時指定 `embedding_model` (如 `bge-m3`)。
- [ ] **R6: 引用來源回傳**：從 Dify `metadata.retriever_resources` 解析資料，並封裝進 SDK Response 的 `references` 屬性。
- [ ] **R7: 錯誤映射**：將內部錯誤轉化為 401 (Auth), 429 (Rate Limit), 503 (Service) 等標準狀態碼。

## Acceptance Criteria

- [ ] **介面一致性**：使用官方 OpenAI Python SDK 修改 `base_url` 後，能成功與 Gateway 通訊並取得回應。
- [ ] **串流驗證**：在 `stream=True` 模式下，前端能正確接收並顯示逐字生成的「打字機效果」。
- [ ] **模型切換測試**：傳入不同 `llm_model` 時，確認 Gateway 轉發給 Dify 的 Payload 已正確變更模型設定。
- [ ] **隔離性測試**：使用 A 客戶的 Key 無法存取 B 客戶定義在 Dify 中的 App 資源。
- [ ] **非同步性能**：在高併發下，透過 `AsyncBSAI` 調用需保持 I/O 非阻塞且回應延遲在合理範圍。

## Out of Bounds（不能改）

- 不改動 Dify 核心源碼（維持 Gateway 為獨立微服務）。
- 不修改現有向量資料庫（Qdrant）的 Index 結構。

## Technical Notes

- **技術選型**：使用 **FastAPI** 配合 **httpx (Async)** 處理代理請求。
- **資料儲存**：客戶註冊資訊（Mapping Table）第一階段採用 **SQLite** 或 **YAML** 配置。
- **Streaming 處理**：利用 FastAPI 的 `StreamingResponse` 與異步生成器 (Generator) 實作。
- **SDK 支援**：需同時提供同步 (Sync) 與非同步 (Async) 的 Python Client 範例。

## References

- OpenAI API Reference: https://platform.openai.com/docs/api-reference
- Dify API Documentation (App-level)
- [專案架構] O-RAN Localized LLM + RAG 整合計畫

## Spec 變更歷史

- 2026-05-09：由 luluwen 建立初稿，定義 OpenAI 相容層與 Gateway 路由邏輯。