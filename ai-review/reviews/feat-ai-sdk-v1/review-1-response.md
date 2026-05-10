# Review Response: feat-ai-sdk-v1 — Round 1

> Response to `reviews/feat-ai-sdk-v1/review-1.md` (codex v0.130.0,
> `model_reasoning_effort=high`).

## Summary

| 嚴重度 | 找到 | 已修 | 不修 |
|---|---|---|---|
| [P1] | 1 | 1 | 0 |
| [P2] | 1 | 1 | 0 |

> Note: codex 輸出在 line 9561-9574 共出現兩組 [P1] + [P2]，內容完全相同，
> 是 codex 自身格式化的重複貼出（"Full review comments" 區塊重複），實際是 1 + 1 = 2 個 unique findings。

## Findings 處理紀錄

---

### Finding 1: [P1] Use Dify's cookie/CSRF session for console calls

- **Severity**: [P1]
- **Codex 描述**:
  > With the current Dify console API, `POST /console/api/login` returns
  > `{"result":"success"}` and sets the access/CSRF tokens as cookies rather
  > than returning `data.access_token`. This makes every lazy App build fail
  > at login with `Dify console login returned unexpected payload`; the
  > subsequent console POSTs also need the CSRF cookie/header instead of
  > only a bearer header.
- **影響檔案**: `gateway/src/gateway/dify/client.py:177-181`
- **動作**: ✅ Fixed

#### 驗證

讀過 Dify 源碼確認 codex 完全正確：

- `api/controllers/console/auth/login.py:150` 註解明寫 *"Create response with
  cookies instead of returning tokens in body"*。Lines 153-155 把 access、
  refresh、csrf 三個 token 全部用 `set_*_to_cookie()` 寫進 cookies。
- `api/libs/token.py:178-203` `check_csrf_token()` 強制要求 `X-CSRF-Token`
  header 跟 `csrf_token` cookie 兩者**值要相等**，少一個或不一致都 raise
  `Unauthorized`。CSRF whitelist 只有 `/console/api/apps/[id]/workflows/draft`
  一條，`apps/imports`、`apps/[id]/api-keys`、`DELETE apps/[id]` 都被檢查。
- `api/libs/token.py:75-79` `extract_access_token()` 接受 cookie **或**
  `Authorization: Bearer` header。

#### 修復內容

新增 `ConsoleSession(access_token, csrf_token)` 不可變資料類；console_login
改成從 `Set-Cookie` 取出兩個 token（容忍 `__Host-` 前綴的 secure deploy
變體）；後續 console 呼叫同時送：

- `Authorization: Bearer <access_token>`
- `X-CSRF-Token: <csrf_token>` header
- 完整 cookie jar（access_token + csrf_token）

`AppManager._refresh_jwt`/`_with_jwt` 改名 `_refresh_session`/`_with_session`
並改傳 `ConsoleSession`，內部 `_CachedJwt` → `_CachedSession`。

#### Commits

- `9890bbad0` fix(gateway): console API uses cookies + CSRF, not bearer JWT (P1 from review-1)
- `9857f310d` test(gateway): update tests for ConsoleSession (cookie + CSRF) auth flow

---

### Finding 2: [P2] Return auth failures from middleware instead of raising

- **Severity**: [P2]
- **Codex 描述**:
  > For missing or unknown SDK keys, this raises `InvalidSdkKeyError` from
  > user middleware, which runs outside FastAPI's `ExceptionMiddleware`; the
  > `@app.exception_handler(GatewayError)` handler will not render the
  > intended 401 envelope, so these requests become 500s or propagated ASGI
  > exceptions. Return the 401 response directly here or move auth into a
  > dependency/route layer that FastAPI exception handlers wrap.
- **影響檔案**: `gateway/src/gateway/middleware/auth.py:75-80`
- **動作**: ✅ Fixed

#### 驗證

確認是真 bug。FastAPI 中介軟體鏈順序：

```
ServerErrorMiddleware
  └── [user middleware: AuthMiddleware]   ← 我的 middleware 在這
        └── ExceptionMiddleware           ← @app.exception_handler 註冊在這
              └── Router
```

`AuthMiddleware.dispatch` 在 `await call_next(request)` 之前 raise，例外往
**上**冒泡，繞過 `ExceptionMiddleware`，最終由 `ServerErrorMiddleware` 變
500。我的測試 `test_blocking_unknown_sdk_key_returns_401` / 
`test_blocking_missing_authorization_returns_401` 之所以沒抓到，是因為**測試
從未實際被執行過**——codex 純靜態分析就找出這個問題。

#### 修復內容

`AuthMiddleware.dispatch` 內 try/except `GatewayError`，直接回 `JSONResponse`
帶上 `exc.status_code` + OpenAI envelope。`@app.exception_handler(GatewayError)`
保留，仍處理從路由 handler 拋出的 `UnknownModelError` 等（那些 ExceptionMiddleware
看得到）。

#### Commits

- `88a6a386b` fix(gateway): catch GatewayError inside AuthMiddleware (P2 from review-1)

---

## 整體決策

- 走完 Round 1 後狀態：**進 review-2**（驗證兩處修復、檢查是否引入新問題）
- 風險評估：
  - P1 修法**改動 DifyClient 公開介面**（簽名從 `jwt: str` 變
    `session: ConsoleSession`），測試已同步更新但實際 Dify 整合測試尚未跑
    （要等 Dify 實機驗證）。
  - P2 修法簡單，但 `@app.exception_handler` 跟 middleware 內 catch 是兩條
    路徑——日後加新 GatewayError 子類要記得兩邊行為都對。
- 後續追蹤：
  - **TODO（非 review-1 範圍）**：寫整合測試針對真實 Dify v1.x 實例驗證
    cookie/CSRF 流程（目前只有 unit + respx mock）。這應在 PR #2 或之前的
    POC 階段做。

## 預備 Round 2 的觀察點

預期 codex review-2 會看：
1. ConsoleSession 是否在所有 console 呼叫路徑被一致使用？
2. JSONResponse 在 middleware 的回應有無漏 header（例如 request_id 沒 echo）？
3. 是否引入新的 [P1]？
