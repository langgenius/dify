# Full Navigation/Preflight Evaluation Summary

Date: 2026-05-05

## Scope

- Strengthened WSL/Docker preflight checks.
- Rebuilt the navigation skill tree for the full processed corpus.
- Ran nav-only evaluation across all official case sets.
- Ran full RAG evaluation across all official case sets.
- Refactored structured policy answers to return answer text and evidence resources together.

## Preflight

`./tools/preflight_eval.sh --fix` passed after adding:

- Docker CLI responsiveness check.
- Required service health checks for `db_postgres`, `redis`, `ollama`, and `docproc`.
- Blocking chat probe through the plugin daemon path.

## Navigation-Only Eval

Output prefix:

- `NAVTREE-FULLSET-20260505-SCORE3`

Strong sets:

- `generalization_boost_matrix_cases`: 100% doc/page Top1.
- `holdout_cases_mar15_multi`: 100% doc/page Top1.
- `mar16_detail_qa_cases`: 100% doc/page Top1.
- `mar16_new_pdfs_cases`: 100% doc/page Top1.
- `mar16_newdoc_cases`: 100% doc/page Top1.
- `mar22_multiformat_ocr_cases`: 100% doc/page Top1.

Known nav-only residuals:

- `eval_cases`: one ambiguous precision/recall case still ranks `rag-multi-sheet-test.xlsx` over `rag-paper-layout-test.pdf`.
- `holdout_cases_mar15`: old ambiguous `Figure 7` / `Table 3` queries need a document hint to disambiguate AlphaSite vs BetaHarbor.
- `mar22_policy_natural_cases` and `mar30_natural_query_variants_cases`: Top5 usually contains the expected document, but some broad policy queries are not always doc Top1 in nav-only mode.

## Full Eval

Output prefix:

- `FULL-NAV-PREFLIGHT-20260505`

All 10 official sets completed with:

- `chat_success_rate`: 100%
- `chat_timeout_rate`: 0%
- no plugin daemon or Docker/WSL infrastructure failure

Notable full-eval results:

- `eval_cases`: all 100%.
- `holdout_cases_mar15_multi`: all 100%.
- `mar16_newdoc_cases`: all 100%.
- `mar22_multiformat_ocr_cases`: all 100%.

Residual answer-quality issues before structured citation refactor:

- `boost_rbigbt_improvement`: returned `95.1%` efficiency instead of `1.3%` improvement.
- `holdout_cases_mar15`: old ambiguous queries without AlphaSite/BetaHarbor hints still select the wrong same-label document.
- policy/natural structured answers were correct but citation metadata could point to weak resources.

## Structured Citation Recheck

Output prefix:

- `FULL-NAV-STRUCTURED-CITES-20260505`

Rechecked targeted affected sets:

- `mar22_policy_natural_cases`: answer and chat reference doc/page all 100%.
- `mar30_natural_query_variants_cases`: answer and chat reference doc/page all 100%.
- `generalization_boost_matrix_cases`: remaining issue is answer value for `boost_rbigbt_improvement`.
- `holdout_cases_mar15`: remaining issue is ambiguity in old no-document-hint cases.

## Remaining Work

- Add bounded backtracking/candidate cache for ambiguous same-label queries and metric-vs-value confusion.
- Use validation conditions such as requested document hint, requested label, expected metric type, answer unit, and citation consistency to decide whether to retry a different branch.
- Keep retry count fixed at 1-2 and return either the best validated candidate or a clear not-found answer.

