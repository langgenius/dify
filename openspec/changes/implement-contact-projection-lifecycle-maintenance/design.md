## Context

`HumanInputContact` 是 Account/member source facts 的业务投影。一次性 initialization import 可以在发布时补齐既有数据，但无法覆盖后续 Account/member 写入，也无法修复绕过权威 application operation 的历史脚本、迁移或异常写入造成的漂移。

Contact lifecycle 与 provider directory sync 具有不同的 owner、触发源和故障域。前者必须由 Contact Directory owner 持续维护；后者是管理员可选的 IM identity/binding 对账，只能消费 current Contact projection。Initial Contact import 继续由 `initialize-human-input-contact-projection` 通过版本升级命令 `flask data-migrate human-input-contacts --apply` 拥有，本 change 仅负责初始化完成后的持续生命周期与独立 periodic repair。

现有 deployment 语义必须保留：CE/SaaS 的 Contact identity 属于 workspace；EE 的 canonical Contact 属于 Organization。Account disabled 是 current availability fact，不是 Contact deletion。历史 workflow、task 与 audit 继续依赖冻结 snapshot，而不是 current Contact lookup。

## Goals / Non-Goals

**Goals:**

- 在 authoritative Account/member application operations 中持续创建、更新或移除 source-backed Contact projection。
- 让 write-through 与 periodic reconciliation 复用同一组 deployment-aware transition rules。
- 保持 Account disabled 时 canonical Contact 与 Contact ID 不变，并由 current reads、recipient authorization 与 matching 使用 authoritative availability 排除该 Contact。
- 固化 CE/SaaS removal/rejoin 与 EE membership/Platform allow-list 的不同 identity 语义。
- 提供分页、幂等、可恢复且可观测的 periodic reconciliation，用于修复旁路写入造成的 projection drift。
- 保证 Contact read 与 manual IM sync 不承担 projection 创建、补偿或修复职责。

**Non-Goals:**

- 不实现或复制一次性 Contact initialization data migration；该能力由 `initialize-human-input-contact-projection` change 通过 `flask data-migrate human-input-contacts --apply` 交付。
- 不修改 provider directory fetch、IM reconciliation algorithm、manual sync scheduling 或 sync result contract。
- 不把 Account disabled 建模为 Contact update/delete，也不为 disabled Account 分配新的 Contact ID。
- 不改变历史 workflow、task 或 audit snapshot 语义。
- 不在 EE façade、Workspace controller、IM worker 或 repository adapter 中复制 Contact lifecycle orchestration。

## Decisions

### 1. Contact Directory owner is the only projection writer

`OrganizationContactProjectionService` owns Account/member-to-Contact transition rules. Authoritative Account/member application operations and the periodic reconciliation task call this service through transport-neutral commands; Workspace/EE transports、IM services、workers and read repositories cannot create or repair Contacts.

The service accepts trusted source facts and deployment scope rather than Flask requests、controller DTOs、ORM sessions or EE principal types. This keeps CE/SaaS and EE adapters on one business boundary while allowing each owning application operation to provide its own authenticated actor and audit context.

An alternative is to update Contacts from Account/member event consumers. That introduces asynchronous visibility gaps and makes a successfully committed source mutation temporarily inconsistent with recipient selection. Because these records share the Dify persistence boundary, the authoritative application operation is the primary integration point; periodic reconciliation remains the recovery path for writes that bypass it.

### 2. Write-through and repair share one deterministic transition engine

The projection service derives a desired transition from current Account、membership、deployment and Platform allow-list facts, then applies it idempotently:

- eligible Account/member creation、profile update and membership add create or update the source-backed Contact while preserving the existing Contact ID;
- Account disable/delete changes availability only and does not write or delete the canonical Contact;
- CE/SaaS membership removal hard-deletes the workspace-owned Contact and its current IM bindings; a later rejoin creates a new Contact ID;
- EE membership removal preserves the Organization-owned Contact; current membership and the Platform allow-list determine whether the workspace resolves it as `PLATFORM` or `ABSENT`;
- External Contact deletion continues to hard-delete its workspace-owned identity and current IM bindings.

Both write-through and periodic repair use the same transition function and repository mutation methods. The transition function performs no provider I/O and does not depend on sync state.

Maintaining separate rules for foreground writes and repair would allow their identity/deletion semantics to diverge, so it is rejected.

### 3. Contact transition is part of the owning application operation

For source mutations that require a Contact write, the Account/member mutation and Contact transition execute in one explicit application operation and database transaction. A Contact constraint or persistence failure prevents that operation from reporting success. CE/SaaS Contact removal and current IM binding cleanup occur in the same transaction as the membership removal.

Account disable is intentionally excluded from Contact mutation: the source Account status is committed normally, and all current Contact queries、recipient selection、pending-task authorization and IM Email matching evaluate that authoritative status. Reactivation therefore exposes the same canonical Contact ID again.

An asynchronous dual-write would reduce foreground coupling but permit a source mutation to succeed before the projection is safe to consume. The periodic reconciler is not a substitute for the primary consistency boundary.

### 4. Periodic reconciliation is bounded, idempotent and independent from IM sync

The lifecycle owner schedules a dedicated reconciliation task that scans authoritative source facts in stable pages. Each page loads the corresponding current Contact/binding state, applies the shared transition rules in bounded transactions, records progress and can be retried without creating duplicate Contact identities or repeating completed deletions.

Only one reconciliation for the same deployment scope may apply a page at a time. A failed page retains enough checkpoint information to retry that page; later runs may safely revisit already processed source facts. Metrics distinguish scanned、created、updated、deleted、unchanged、failed and remaining/checkpoint progress, without Contact PII.

The task has no provider credential、provider directory or manual-sync dependency. It repairs only Account/member projection drift; it does not reconcile IM directory membership.

### 5. Reads consume current facts without repairing projection

Contact list/detail、recipient selection、pending-task authorization and IM Email matching combine persisted Contact identity with current authoritative availability and workspace resolution. They omit `ABSENT` or unavailable Contacts and return `404 Not Found` for unavailable detail reads, but they do not create、update or delete Contacts.

Manual IM sync follows the same read-only rule. After provider fetch, its existing guarded reconciliation input load reads currently eligible Contact、membership、identity and binding facts immediately before planning/apply; missing Contact projection remains a lifecycle health signal for the dedicated reconciler rather than triggering sync-time compensation.

This avoids coupling Contact correctness to an optional administrator action and keeps sync latency and failure semantics independent from lifecycle repair.

## Risks / Trade-offs

- [Foreground Account/member operations gain a Contact dependency] → Keep transition logic provider-free and transaction-local; cover rollback and constraint failures explicitly.
- [Periodic reconciliation overlaps an authoritative write] → Serialize page apply per deployment scope and re-read current source facts inside the bounded transaction before deriving the transition.
- [A source row changes across page boundaries] → Use stable pagination/checkpoint keys and idempotent transitions; later runs safely revisit changed rows.
- [CE/SaaS hard-delete removes current bindings] → Keep historical display on frozen snapshots and test that rejoin receives a new Contact ID without inheriting old pending-task authority.
- [Availability checks are omitted by a new read path] → Centralize workspace resolution/current availability predicates and add architecture/query-contract tests for every Contact consumer.
- [Rollout enables sync before lifecycle correctness is established] → Keep the production capability gate closed until initialization import and this lifecycle change both pass release verification.

## Migration Plan

1. Run and verify `flask data-migrate human-input-contacts --apply` as the version-upgrade initialization owned by `initialize-human-input-contact-projection`; keep production Contact/IM capability gates closed.
2. Introduce the shared projection transition service and current availability predicates without enabling the periodic schedule.
3. Connect authoritative Account/member create、profile update、membership add/remove and deployment-specific Platform allow-list operations to the service; verify transactional rollback and identity semantics.
4. Run the periodic reconciler in observe/dry-run mode, compare projected actions with source facts, then enable bounded repair.
5. Enable production gates only after write-through failures、repair drift and checkpoint progress remain within release thresholds.

Rollback disables the periodic schedule and production capability gate. Authoritative write-through remains enabled once deployed because disabling it would recreate drift; if it must be rolled back, Account/member mutations that require Contact transitions must be gated until the previous compatible lifecycle implementation is restored.

## Open Questions

- The deployment-specific scheduler cadence and page-size defaults are operational configuration; they do not change the lifecycle contract.
- The concrete rollout thresholds for projection drift and failed transitions must be set by the deployment owner before production enablement.
