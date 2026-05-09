# Review Response: <feature-id> — Round <N>

> 對 `reviews/<feature-id>/review-<N>.md` 的逐項回應。
> 每個 codex finding 都要有對應動作或 rationale。

## Summary

| 嚴重度 | 找到 | 已修 | 不修（含理由） |
|---|---|---|---|
| [P1] | N | N | 0 |
| [P2] | N | N-X | X |

## Findings 處理紀錄

### Finding 1: <codex 標題>

- **Severity**: [P1] / [P2]
- **Codex 描述**: <貼原文，1-2 行>
- **影響檔案**: `path/to/file.py:123`
- **動作**: ✅ Fixed / ⏭️ Deferred / ❌ Won't fix

#### 修復內容（如有）

```diff
- old code
+ new code
```

Commit: `<short hash>`

#### Rationale（如不修）

如果選 Deferred / Won't fix，這裡寫**詳細理由**。
範例：
> Codex 建議用 `secrets.compare_digest` 防 timing attack，但這個 endpoint 已經
> 在 Cloudflare WAF 後面有 rate limit，timing attack 在我們架構下不是真威脅。
> 為了優先處理 R1-R3，這個 P2 deferred 到下一個 sprint。

---

### Finding 2: <下一個>

（同上格式）

---

## 整體決策

- 走完 Round <N> 後狀態：[進 review-<N+1> / 進 polish / STOP 找人類]
- 風險評估：[簡述還剩什麼疑慮]
- 後續追蹤：[如有 deferred items 開 ticket，連結貼這]
