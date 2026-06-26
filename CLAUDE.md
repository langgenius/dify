# CLAUDE.md

This file is intentionally short. Claude Code and other agents should use `AGENTS.md` as the primary repository instruction file, then read these enterprise documents before changing enterprise behavior:

- `README.enterprise-maintenance.md`
- `ENTERPRISE_REPLAY_PLAN.md`
- `docker/README.enterprise.md`

Current enterprise truth:

- Official stable tag/tree `1.15.0` is the current enterprise release baseline.
- `codex/enterprise-candidate-1.15.0-20260626` is the clean candidate rebuilt from official `1.15.0`.
- The previous `enterprise/main`, `codex/enterprise-candidate-20260424`, and `D:\CodexSpace\dify-enterprise-candidate-20260424` are historical `1.13.3` references only.
- Do not revive old dirty-branch assumptions unless a patch is explicitly listed in the replay plan or re-proven by current-source tests and runtime validation.
- Never open enterprise candidate pull requests against `langgenius/dify`; PRs, if needed, must stay inside `D-S-William-Guo/dify` with the fork as the base repository.

Behavioral rules:

- Think before coding: state assumptions, surface ambiguity, and stop when the requirement is unclear.
- Simplicity first: implement the minimum requested behavior without speculative abstractions.
- Surgical changes: touch only files needed for the task and do not clean unrelated code.
- Goal-driven execution: define verification, run the closest checks, rebuild enterprise images when runtime code changes, and validate browser behavior against the rebuilt containers.
