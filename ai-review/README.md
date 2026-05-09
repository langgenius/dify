# AI-Assisted Code Review Workflow

Spec → Claude 實作 → Codex review → Claude fix → Codex review → Polish → 人類 approve。

## 適用範圍

✅ **使用**：
- 高風險變更（auth、加密、infra、跨服務介面）
- 中等規模功能（>200 LOC 或涉及 ≥3 個模組）
- 部署/CI/CD 腳本

❌ **不使用**：
- typo / README 修正
- 純 refactor 無語意改動
- 依賴 patch 版本 bump

## 目錄結構

```
ai-review/
├── README.md               # 本檔
├── specs/                  # 你的需求規格（每個 feature 一個 .md）
│   └── TEMPLATE.md
├── reviews/                # AI review 產出（每個 feature 一個子目錄）
│   └── <feature-id>/
│       ├── review-1.md
│       ├── review-1-response.md
│       ├── review-2.md
│       ├── review-2-response.md
│       └── audit.md
├── templates/              # 各種模板
│   ├── review-response.md
│   └── audit.md
└── scripts/
    └── run-cycle.sh        # 半自動 driver
```

## 流程概觀

```
[你: 寫 spec]
      ↓
specs/<feature-id>.md
      ↓
[Claude: 實作]
      ↓
feature branch + commits
      ↓
[Codex: review #1]      ──→ reviews/<id>/review-1.md
      ↓
[Claude: fix #1]        ──→ commits + reviews/<id>/review-1-response.md
      ↓
[Codex: review #2]      ──→ reviews/<id>/review-2.md
      ↓
[Claude: polish]        ──→ final commits
      ↓
[Optional: audit]       ──→ reviews/<id>/audit.md
      ↓
[Human: approve PR]
```

## 收斂規則

| 狀況 | 動作 |
|---|---|
| Review N+1 沒新 [P1] 且 [P1] 全處理 | ✅ 進 polish |
| Review N+1 還有新 [P1] | ⚠️ 進下一輪 |
| 第 3 輪仍有 [P1] | 🛑 STOP，人類介入 |

**硬上限：3 輪**。

## 使用步驟

### Step 1：寫 spec

```bash
cp ai-review/specs/TEMPLATE.md ai-review/specs/your-feature-id.md
# 編輯它，填入 Goal / Requirements / Acceptance Criteria
```

### Step 2：跟 Claude 講

```
基於 ai-review/specs/your-feature-id.md 實作。
所有 commit 標 [WIP]，最後一個 commit 標 [READY-FOR-REVIEW]。
```

### Step 3：跑 codex review #1

```bash
mkdir -p ai-review/reviews/your-feature-id
codex review --base main \
  -c 'model_reasoning_effort="high"' \
  --enable web_search_cached \
  > ai-review/reviews/your-feature-id/review-1.md 2>&1
```

或讓 Claude 用 `/codex review` skill 觸發。

### Step 4：跟 Claude 講「處理 review-1」

```
處理 ai-review/reviews/your-feature-id/review-1.md。
逐項修復，每個 finding 一個 commit。
無法修的寫進 review-1-response.md 並說明 rationale。
```

### Step 5：跑 codex review #2

```bash
codex review --base main \
  -c 'model_reasoning_effort="high"' \
  --enable web_search_cached \
  > ai-review/reviews/your-feature-id/review-2.md 2>&1
```

### Step 6：判斷收斂

```bash
grep -c '\[P1\]' ai-review/reviews/your-feature-id/review-2.md
```

- 0 → 進 polish
- >0 → 跟 Claude 講繼續修，或人類介入

### Step 7：開 PR

```bash
gh pr create --title "..." --body "see ai-review/specs/your-feature-id.md and reviews/"
```

## 半自動 driver

```bash
./ai-review/scripts/run-cycle.sh your-feature-id
```

driver 會在每階段 prompt 你「按 Enter 繼續」，搭配 Claude Code session 互動式跑完。

## Artifact 永久保存

`specs/` 與 `reviews/` 都進 git，作為決策軌跡。重要不要 `.gitignore` 它們。

## 相關文件

- `templates/review-response.md` — 對 codex finding 的回應格式
- `templates/audit.md` — 第三方審計模板
- Codex 文件：https://github.com/openai/codex
