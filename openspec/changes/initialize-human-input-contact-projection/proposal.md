## Why

现有 schema migration 只创建 Human Input Contact 表，版本升级尚未把已有 eligible Account/member 初始化为 source-backed Contact。该初始化属于 Contact Directory 的一次性运维生命周期，必须独立于 optional IM sync、HTTP read 和后续 periodic lifecycle maintenance。

## What Changes

- 在 `flask data-migrate` namespace 增加 `human-input-contacts` 命令，默认 dry-run，只有显式 `--apply` 才提交写入。
- 修正 Contact Directory 的 normalized Email uniqueness，使同一 workspace 的 External Contact 只与其他 External Contact 冲突，internal/external same-email 可以共存。
- 使用稳定 keyset cursor、小页 transaction 和 immutable Plan/Apply 执行幂等 initialization；Apply 不重新读取 source facts 或重新规划 action。
- 仅输出 non-PII JSONL audit events；成功 commit、reuse/no-op、rollback、write failure 和 read failure 必须可区分。
- write failure rollback 整页后继续后续页面并最终返回 non-zero；source/page read failure 立即停止。整条命令可以从头安全重跑。
- initialization 不读取 provider directory，不创建 IM identity/binding，也不由 HTTP、Contact read 或 manual sync 隐式触发。

## Capabilities

### New Capabilities

无。

### Modified Capabilities

- `contact-directory-governance`: 增加显式、幂等的版本升级 initialization，并澄清 source-backed Contact 与 External Contact 的 Email uniqueness 边界。

## Impact

- Backend: `api/commands/data_migrate.py`、Contact Directory domain/repository primitives、SQLAlchemy constraints/migrations 和 focused tests。
- Operations: version-upgrade dry-run/apply JSONL review、failure recovery 和 rollout gate。
- Dependencies: `implement-contact-projection-lifecycle-maintenance` 消费 initialization 结果，但继续独立拥有 authoritative write-through、availability 和 periodic repair。
- Excluded: HTTP Contact APIs、IM provider adapters、manual sync 和 binding commands。
