# Review Response: feat-ai-sdk-v1 — Round 3

> Response to `reviews/feat-ai-sdk-v1/review-3.md`.

## Summary

| 嚴重度 | 找到 | 已修 | 不修 |
|---|---|---|---|
| [P1] | **0** | — | — |
| [P2] | 2 | 2 | 0 |

**Convergence achieved**: Round 3 surfaced no [P1] findings. Per the spec'd
convergence rule, this round is the gating round. The two [P2] findings are
both spec-compliance gaps (R3 model override; R7 error envelope shape) and
were fixed because they directly affect the contract documented in the spec
+ README; a partial implementation would have shipped as a known regression.

## Findings 處理紀錄

---

### Finding 1: [P2] Honor `extra_body.llm_model` when selecting the Dify App

- **Severity**: [P2]
- **Codex 描述**:
  > When clients follow the spec/README and send `extra_body={"llm_model": "m2"}`,
  > the OpenAI SDK places that as a top-level `llm_model` field, but this path
  > always validates and builds the app from `body.model`. In that scenario
  > model switching is ignored, or the request can 404 if `model` is just a
  > placeholder while `llm_model` is enabled for the customer.
- **影響檔案**: `gateway/src/gateway/routers/chat.py`,
  `gateway/src/gateway/schemas.py`
- **動作**: ✅ Fixed

#### 驗證

Spec R3 文字：
> 若 `extra_body` 包含 `llm_model`，需動態覆蓋 Dify 的 `model_config` 以實現
> 模型切換。

OpenAI Python SDK 把 `extra_body={"foo": "bar"}` 攤平到 request body 的最外
層作為額外欄位，所以這個欄位實際上是以 top-level `llm_model` 存在 JSON 中，
而不是巢狀在 `extra_body` 裡。我之前的實作只看 `body.model`，根本沒消耗
`llm_model` 欄位 — spec 漏實作。

#### 修復內容

1. `ChatCompletionRequest` 顯式宣告 `llm_model: str | None = None`，提供
   typed access path（仍保留 `extra="allow"` 因為 OpenAI 之後可能加新欄位）。
2. 路由層計算：
   ```python
   selected_model = body.llm_model or body.model
   ```
   並用 `selected_model` 做 `app_manager.get_app_key(...)` 與 response
   `model` echo（OpenAI 標準：response.model 必須反映「實際使用的模型」）。
3. Streaming 分支的 `dify_to_openai_chunks(model_id=...)` 也改用
   `selected_model`，所以每個 chunk 都帶正確的 model id。

#### Tests

- `test_extra_body_llm_model_overrides_app_selection`: 帶 `llm_model="m2"`
  且 `model="placeholder-ignored"`，response 的 `model` 必須是 `m2`。
- `test_extra_body_llm_model_unknown_returns_404`: `llm_model` 指向不存在
  的 model 時回 404，**即使 `model` 欄位本身是合法的**（防止 fallback 掩蓋
  override 的錯誤）。

#### Commit

- `87c0b911d` fix(gateway): honor extra_body.llm_model for App selection (R3-P2)

---

### Finding 2: [P2] Map request validation failures to the OpenAI error envelope

- **Severity**: [P2]
- **Codex 描述**:
  > Requests that fail FastAPI/Pydantic validation before entering the
  > router, such as missing `messages` or an out-of-range `temperature`,
  > bypass this `GatewayError` handler and return FastAPI's default 422
  > `detail` payload. That breaks the gateway's OpenAI-compatible/R7 error
  > contract for common invalid client inputs.
- **影響檔案**: `gateway/src/gateway/main.py`
- **動作**: ✅ Fixed

#### 驗證

FastAPI 的 `RequestValidationError` 由 `ExceptionMiddleware` 處理，預設
handler 回 422 with body `{"detail": [...]}`。OpenAI 規範用 400 with
`{"error": {message, type, code, param}}`。我的 `@app.exception_handler(GatewayError)`
不會接到 `RequestValidationError`（它不是 `GatewayError` 的子類），所以
schema 違規完全繞過 R7 的規範化錯誤格式。

#### 修復內容

註冊 `@app.exception_handler(RequestValidationError)`：
- 取第一個 `errors[0]`，把 `loc` 接成 dot path 當 `param`、`msg` 當
  `message`。
- 包成 `InvalidRequestError(message, param=loc)` → 標準 400 envelope。
- 完整 `errors` list 以 `error.errors` 附在 envelope 裡（envelope schema 的
  `extra="allow"` 允許），讓需要 field-level 細節的 client 仍可拿到。

#### Tests

- `test_pydantic_validation_error_returns_openai_envelope`: 缺 `messages`
  欄位 → 400 + `error.type=invalid_request_error` + `error.errors` 非空。
- `test_validation_error_out_of_range_temperature`: `temperature=5.0`
  超過 `le=2.0` → 400 with same envelope shape。

#### Commit

- `404e539be` fix(gateway): map RequestValidationError to OpenAI envelope (R3-P2)

---

## 整體決策

- 走完 Round 3 後狀態：✅ **進 polish + open PR**
- 收斂軌跡：
  - Round 1: 1 P1 + 1 P2（架構性）
  - Round 2: 1 P1 + 1 P2（前一輪修法的細節遺漏）
  - Round 3: **0 P1** + 2 P2（spec 漏實作，非新風險）
- 不再跑 Round 4：每輪剩餘問題的範圍持續縮小（架構 → 細節 → spec gap），
  按收斂規則已可進 polish。

## Polish 計畫

下一步將：
1. **Squash WIP commits**: 把 `[WIP]` 系列壓成一個乾淨的 base commit；
   每個 fix commit 各自保留作為 review trail（codex/PR reviewer 能精準看
   到「P1 fix vs P2 fix」對應到哪個檔案改動）。
2. **PR description**: 連結 spec、3 輪 review、3 個 response 文件。
3. `gh pr create` to base `main`.
