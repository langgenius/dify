# Final Audit: <feature-id>

> 第三方獨立審計（codex challenge / 第二位 Claude / 人類資深工程師）。
> 寫的人**完全不看** review-1, review-2, response 等 artifact，只看最終 diff。

## Auditor

- 類型：Codex challenge / Claude (zero-context sub-agent) / Human (<姓名>)
- 執行日期：YYYY-MM-DD
- 執行 commit：`<full hash>`

## Scope

審計只看：
- `git diff main...HEAD`
- `specs/<feature-id>.md`

**不**看：
- 之前的 review 檔
- response 檔
- 任何已存在的「為什麼這樣寫」討論

## Adversarial Findings

把這個當成「找麻煩」而非「找小錯」——重點不是 lint 等級的問題，是：

### 安全性

- [ ] 有沒有可能被注入？
- [ ] 認證/授權邏輯是否真的安全？
- [ ] 敏感資料會不會洩漏到 log / response / metrics？
- [ ] 加密用得對嗎（IV、padding、key derivation）？

### 並發 / 競賽條件

- [ ] 多 request 同時打會不會壞？
- [ ] 共享狀態有沒有 lock / atomic 保護？
- [ ] 重試邏輯會不會造成 double-write？

### 失敗模式

- [ ] 下游服務 timeout 怎麼處理？
- [ ] 部分失敗（partial failure）會留下髒資料嗎？
- [ ] Resource leak（fd / connection / memory）？
- [ ] 邊界輸入（空字串 / 超大 payload / 特殊字元）？

### 可運維性

- [ ] 出問題時 log 夠不夠 debug？
- [ ] Metric 能不能讓 oncall 5 分鐘定位問題？
- [ ] 部署時有沒有 backward compat 風險？

## 結論

| 項目 | 狀態 |
|---|---|
| 是否建議 ship？ | ✅ Yes / ⚠️ Yes with conditions / 🛑 No |
| 必須修的（block ship） | <列出> |
| 建議修但不 block | <列出> |
| 後續監控重點 | <列出> |

## 簽核

- 審計者: <name / handle>
- 日期: YYYY-MM-DD
- 簽核 commit: `<hash>`
