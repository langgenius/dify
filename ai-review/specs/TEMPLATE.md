# Feature: <名稱>

> 複製本檔：`cp ai-review/specs/TEMPLATE.md ai-review/specs/<feature-id>.md`
> 然後刪掉這行引言並填空。

## Feature ID

`<feature-id>` （短橫線命名，例：`sdk-gateway-auth`、`profile-script-v2`）

## Owner

<你的名字 / GitHub handle>

## Status

- [ ] Draft
- [ ] Ready for implementation
- [ ] In review
- [ ] Approved
- [ ] Merged

---

## Goal

一到兩句話講「這個 PR 要達成什麼」。從**用戶或維運角度**寫，不是技術細節。

> 範例：基站 SDK 的 Gateway 層需要驗證客戶 API key 並對應到正確的 Dify 部署，
> 讓客戶呼叫 SDK 時自動路由到他們專屬的 Dify 實例。

## Non-goals

明確列出「這次**不做**的東西」（防 scope creep）。

> 範例：
> - 不處理 rate limiting（下個 PR）
> - 不做 token-level 計費（另一個 spec）
> - 不支援多 region routing

## User Story / 使用情境

```
As a <角色>
I want <能力>
So that <目的>
```

> 範例：
> ```
> As 一個基站工程師
> I want 透過 SDK 一行呼叫 client.chat() 問問題
> So that 我不用懂 Dify 內部結構，產品端程式碼乾淨
> ```

## Requirements

用 checklist 列**可驗證**的需求（不要寫「應該很好用」這種）：

- [ ] R1: 收到請求時，從 `Authorization: Bearer <sdk_key>` header 抽出 SDK key
- [ ] R2: 用 SDK key 查 `CUSTOMER_REGISTRY` 對應到 dify_url + app_key
- [ ] R3: 找不到 → 回 401 `{"error": "invalid_sdk_key"}`
- [ ] R4: 找到 → proxy 請求到對應 Dify，附上正確 app_key
- [ ] R5: 支援 streaming（SSE）跟 blocking 兩種 response_mode
- [ ] R6: 計算每客戶 token 用量寫入 metrics

## Acceptance Criteria

「怎樣算 done」——測試/驗證的具體做法：

- [ ] 單元測試覆蓋每個 requirement，coverage > 80%
- [ ] 整合測試：模擬 2 個客戶各自呼叫，互不干擾
- [ ] 性能：P99 latency 增加 < 10ms（相對於直接呼叫 Dify）
- [ ] 安全：SDK key 不出現在任何 log
- [ ] 文件：寫一段 client 端使用範例

## Out of Bounds（不能改）

- 不改 Dify 主 stack（只能改 Gateway 服務）
- 不改 docker-compose.yaml 主檔（只能改 override）
- 不引入新 Python 套件（除非有 strong rationale 寫在 PR 描述）

## Technical Notes（可選）

如果有設計決策要先講清楚，寫在這。模糊或留白 → 由 Claude 在實作時做合理選擇。

> 範例：
> - 用 FastAPI（已有依賴）
> - SDK Registry 暫時用 dict 寫死，未來可換 Redis（但這次不做）
> - 用 httpx 而非 requests（async 支援）

## References

- 相關文件 / Jira ticket / Slack 討論連結
- 相關 spec / 過去類似 PR

## Spec 變更歷史

- YYYY-MM-DD：初稿
- YYYY-MM-DD：因 codex review 發現問題，增加 R6
