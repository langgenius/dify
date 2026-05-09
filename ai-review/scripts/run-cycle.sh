#!/bin/bash
# AI Review Cycle Driver
#
# 用法：
#   ./ai-review/scripts/run-cycle.sh <feature-id>
#
# 半自動：每階段會 prompt 你「按 Enter 繼續」，搭配 Claude Code session 互動式跑完。

set -euo pipefail

FEATURE="${1:-}"
if [[ -z "$FEATURE" ]]; then
  echo "Usage: $0 <feature-id>"
  echo "Example: $0 sdk-gateway-auth"
  exit 1
fi

REPO_ROOT="$(git rev-parse --show-toplevel)"
SPEC="$REPO_ROOT/ai-review/specs/$FEATURE.md"
REVIEW_DIR="$REPO_ROOT/ai-review/reviews/$FEATURE"
BASE_BRANCH="${BASE_BRANCH:-main}"

# ---------- 檢查 ----------
[[ ! -f "$SPEC" ]] && { echo "Error: Spec not found: $SPEC"; echo "Run: cp ai-review/specs/TEMPLATE.md $SPEC"; exit 1; }
command -v codex >/dev/null || { echo "Error: codex CLI not installed. npm install -g @openai/codex"; exit 1; }
command -v gh >/dev/null || echo "Warning: gh CLI not found, won't auto-create PR"

mkdir -p "$REVIEW_DIR"

# ---------- 工具函式 ----------
pause() {
  echo ""
  echo "════════════════════════════════════════════════════════"
  echo "  $1"
  echo "════════════════════════════════════════════════════════"
  read -p "Press Enter when ready to continue (Ctrl+C to abort)..."
}

count_p1() {
  grep -c '\[P1\]' "$1" 2>/dev/null || echo 0
}

count_p2() {
  grep -c '\[P2\]' "$1" 2>/dev/null || echo 0
}

run_codex_review() {
  local out="$1"
  local round="$2"
  echo "Running codex review (round $round)..."
  codex review --base "$BASE_BRANCH" \
    -c 'model_reasoning_effort="high"' \
    --enable web_search_cached \
    > "$out" 2>&1 || {
    echo "Codex review failed. See $out"
    return 1
  }
  local p1=$(count_p1 "$out")
  local p2=$(count_p2 "$out")
  echo "  → [P1]: $p1, [P2]: $p2"
  echo "  → Saved to: $out"
}

# ---------- Stage 1: Implementation ----------
pause "Stage 1: Implementation
跟 Claude Code 說：
  '基於 $SPEC 實作。
   每個邏輯單元一個 commit，最後一個 commit 訊息含 [READY-FOR-REVIEW]。'
完成實作 + commit 後按 Enter。"

# ---------- Stage 2: Codex Review #1 ----------
echo ""
echo "Stage 2: Codex Review #1"
run_codex_review "$REVIEW_DIR/review-1.md" 1
P1_R1=$(count_p1 "$REVIEW_DIR/review-1.md")

if [[ $P1_R1 -eq 0 ]]; then
  echo "✅ Review #1 沒有 [P1]，可以考慮直接進 polish"
fi

# ---------- Stage 3: Fix #1 ----------
pause "Stage 3: Fix #1
跟 Claude Code 說：
  '處理 $REVIEW_DIR/review-1.md 的所有 findings。
   每個 finding 一個 commit。
   無法修的填寫 $REVIEW_DIR/review-1-response.md
   （複製 ai-review/templates/review-response.md 起手）'
完成 fix 後按 Enter。"

# ---------- Stage 4: Codex Review #2 ----------
echo ""
echo "Stage 4: Codex Review #2"
run_codex_review "$REVIEW_DIR/review-2.md" 2
P1_R2=$(count_p1 "$REVIEW_DIR/review-2.md")

# ---------- 收斂判斷 ----------
echo ""
echo "════════════════════════════════════════════════════════"
echo "  收斂判斷"
echo "════════════════════════════════════════════════════════"
echo "Round 1 [P1]: $P1_R1"
echo "Round 2 [P1]: $P1_R2"

if [[ $P1_R2 -eq 0 ]]; then
  echo "✅ 已收斂，進入 polish"
elif [[ $P1_R2 -lt $P1_R1 ]]; then
  echo "⚠️  Round 2 還有 $P1_R2 個 [P1]（比 Round 1 少）"
  echo "    建議再跑一輪：fix → review-3"
  read -p "繼續跑 round 3? (y/N): " CONT
  if [[ "$CONT" == "y" ]]; then
    pause "Stage 5: Fix #2 → 處理 review-2.md，按 Enter 繼續..."
    echo "Stage 6: Codex Review #3"
    run_codex_review "$REVIEW_DIR/review-3.md" 3
    P1_R3=$(count_p1 "$REVIEW_DIR/review-3.md")
    if [[ $P1_R3 -gt 0 ]]; then
      echo "🛑 Round 3 還有 [P1]，STOP，找人類介入"
      exit 2
    fi
  fi
else
  echo "🛑 Round 2 [P1] 數量沒下降甚至增加 → 設計問題，STOP，找人類介入"
  exit 2
fi

# ---------- Stage 7: Polish ----------
pause "Stage 7: Polish
跟 Claude Code 說：
  '做最後 polish：squash 連續 fix commit、補 docstring、跑 lint。'
完成後按 Enter。"

# ---------- Stage 8: Optional Audit ----------
echo ""
read -p "要跑 final audit 嗎？(y/N): " RUN_AUDIT
if [[ "$RUN_AUDIT" == "y" ]]; then
  echo "Running codex challenge..."
  codex exec "Adversarial audit of changes against $BASE_BRANCH. Find every way this code could fail in production. Be brutal." \
    -C "$REPO_ROOT" -s read-only \
    -c 'model_reasoning_effort="high"' \
    --enable web_search_cached \
    > "$REVIEW_DIR/audit.md" 2>&1
  echo "  → Saved to: $REVIEW_DIR/audit.md"
fi

# ---------- Stage 9: PR ----------
echo ""
echo "════════════════════════════════════════════════════════"
echo "  完成！"
echo "════════════════════════════════════════════════════════"
echo ""
echo "Artifacts:"
echo "  Spec:      $SPEC"
echo "  Review 1:  $REVIEW_DIR/review-1.md"
[[ -f "$REVIEW_DIR/review-1-response.md" ]] && echo "  Resp 1:    $REVIEW_DIR/review-1-response.md"
echo "  Review 2:  $REVIEW_DIR/review-2.md"
[[ -f "$REVIEW_DIR/review-2-response.md" ]] && echo "  Resp 2:    $REVIEW_DIR/review-2-response.md"
[[ -f "$REVIEW_DIR/review-3.md" ]] && echo "  Review 3:  $REVIEW_DIR/review-3.md"
[[ -f "$REVIEW_DIR/audit.md" ]] && echo "  Audit:     $REVIEW_DIR/audit.md"
echo ""

if command -v gh >/dev/null; then
  read -p "用 gh 開 PR? (y/N): " OPEN_PR
  if [[ "$OPEN_PR" == "y" ]]; then
    PR_BODY="## Spec
$SPEC

## Review Artifacts
- Review #1: \`ai-review/reviews/$FEATURE/review-1.md\`
- Review #2: \`ai-review/reviews/$FEATURE/review-2.md\`
$([[ -f "$REVIEW_DIR/audit.md" ]] && echo "- Audit: \`ai-review/reviews/$FEATURE/audit.md\`")

## Convergence
- Round 1 [P1]: $P1_R1
- Round 2 [P1]: $P1_R2

🤖 Implemented & reviewed via AI workflow"
    gh pr create --title "$FEATURE" --body "$PR_BODY"
  fi
fi

echo "Done."
