## Why

Human Input v2 已经在 Dify 主仓库形成 Contact Directory、IM control-plane repository、provider adapter 计划和异步执行基础；如果 EE Go backend 再实现一套 integration CAS、directory sync、reconciliation、worker 与 binding persistence，会让同一业务能力在 Python 和 Go 中出现两个 owner。当前 Dify 与 EE 虽然已有双向依赖，但本 change 必须保证 Human Input admin 这条调用链单向收敛到 Dify，而不是新增一次请求内的 `Dify → EE → Dify` 或 `EE → Dify → EE` 回环。

## What Changes

- 在 EE backend 新增由 Protobuf 描述、由 Kratos 生成和承载的 `EnterpriseHumanInputAdmin` HTTP API；不引入 gRPC server 或 gRPC-Gateway。
- 在 EE `difyclient` 中新增 typed Human Input internal client，把 Organization Contact、IM integration、manual sync、IM identity 与 Organization binding 请求转发给 Dify internal HTTP API。
- 将 provider credential处理、integration CAS、single-active-run、provider directory adapter、reconciliation、worker、Contact projection 与 binding persistence全部保留在 Dify 主仓库，EE 不直接读写 Human Input tables。
- EE 只负责 dashboard administrator 鉴权、Protobuf/HTTP validation、EE-owned human-actor audit、DTO mapping、operation/correlation tracking、超时控制和稳定错误映射；Dify 不接收或保存 EE Dashboard User identity。
- 固定 capability-local 调用方向：EE Dashboard 使用 `EE → Dify`；Dify workspace controller 直接调用同一 Python application service，不能通过 EE Kratos API绕回 Dify。
- 明确排除 EE provider adapter、EE sync worker、EE reconciler、EE Human Input Ent schema/repository、workspace override、Platform/External Contact lifecycle、Email provider、member/workspace CRUD 和自动同步。

## Cross-Repository Ownership

本 change 是存放在 Dify repository 中的 cross-repository coordination plan。Dify 是 Human Input 领域行为与 internal API contract 的 source of truth，但该存放位置不改变 EE 对自身 transport、authentication 与 principal model 的 ownership。

- 本 change 的 `specs/` 只定义 Dify-owned 领域行为、Dify internal API contract 与 `EE → Dify` boundary invariants。
- `tasks.md` 中涉及 EE 的内容仅是 external delivery checklist；每组任务必须标注目标 repository 与 blocking dependency，不作为 Dify 领域规范，也不能由 Dify repo-local apply 执行。
- EE public Protobuf contract、Dashboard authentication/authorization 与 human-actor audit model 由 `dify-enterprise` 代码拥有。它们在本 change 中只作为 integration dependency 被引用，不同步为 Dify main spec。
- 所有 EE implementation 与 generated source 只写入 `dify-enterprise` repository；Dify repository 不承载 EE Go/Protobuf implementation。
- EE implementation 开始前 MUST 在 `dify-enterprise` repository 建立并链接 repo-owned delivery artifact；本 coordination change 不得代替 EE repository 的实现计划或归档记录。

## Capabilities

### New Capabilities

- `human-input-v2-ee-admin-transport`: EE Dashboard 的 Kratos HTTP contract、validation、administrator authentication、service registration 与错误边界。
- `human-input-v2-ee-im-sync-adapter`: EE 对 Dify-owned integration、manual sync 与 latest-only read model 的 typed internal HTTP adapter。
- `human-input-v2-ee-contact-binding-adapter`: EE 对 Dify-owned Organization Contact、IM identity 与 Organization binding control-plane 的 typed internal HTTP adapter。

### Modified Capabilities

- 无。

## Impact

- EE API contract：`dify-enterprise/server/pkg/apis/enterprise/v1/` 及其 Kratos HTTP generated bindings。
- EE application/client：`dify-enterprise/server/pkg/enterprise/service/`、负责 audit/orchestration 的 use case、`server/pkg/difyclient/`、HTTP registration 与 Wire composition。
- Dify upstream dependencies：`initialize-human-input-contact-projection`、`implement-contact-projection-lifecycle-maintenance`、`complete-human-input-im-channel-management`、`integrate-im-contact-sync-runtime` 与 `complete-human-input-contact-binding-api` 分别提供初始化、持续 projection、channel configuration、sync runtime 与 binding application boundaries；另需独立 Dify change 提供 `/inner/api/enterprise/human-input/*` trusted HTTP surface，并让它与 workspace controllers 共用这些 Dify Human Input application services。
- 不影响 EE Dify DB Ent schema，不新增 EE worker/provider dependency，不在 EE repo拥有 Human Input persistence migration。
- Dify normative specification 来源：Dify Contact Directory / IM control-plane core specs 与 Dify internal API contract；`human-input-v2-api-summary.md` 和 `human-input-v2-api-contracts/specs/human-input-ee-admin-api/spec.md` 仅作为 EE delivery contract 输入。
