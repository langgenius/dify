## Context

Human Input v2 的 EE admin contract 已由 API summary 固定为 Organization Contact、IM integration、manual sync、latest-only results、IM identity search与Organization binding十二个 service methods。Dify 主仓库已经拥有 `human_input_v2` domain、SQLAlchemy repository、Human Input tables与Celery执行模型，并已有独立 change负责真实 provider adapter和workspace management API。

当前系统不是严格的单向依赖：

- Dify 通过 `EnterpriseService` 调用 EE inner API获取license、workspace permission、WebApp authorization、SSO/MCP和default workspace等能力；
- EE 通过现有 `difyclient` 调用Dify `/inner/api/enterprise/*` endpoint，并通过Ent读取部分Dify DB数据。

因此本设计不试图消除系统级 `Dify ⇄ EE` 依赖，而是为Human Input capability固定唯一业务owner和无环的operation call graph。Integration CAS、provider fetch、reconciliation、worker、Contact projection与binding transaction若同时在Python和Go实现，会造成最危险的语义重复；它们必须全部留在Dify。

EE backend使用Go 1.25、Kratos、Protobuf HTTP annotations和Wire。这里的Protobuf是Kratos HTTP API definition与code-generation source，不表示本change需要gRPC server或gRPC-Gateway。

### Repository 与 specification ownership

本 change 选择 Dify repository 作为跨仓协调入口，因为 Human Input 领域上下文与 internal API contract 均由 Dify 拥有。该选择只决定 plan 的存放位置，不把 EE implementation ownership 转移给 Dify：

- Dify `specs/` 的 normative scope 仅包含 Dify 领域行为、internal API contract 与跨边界不变量；
- EE public Protobuf、Dashboard authentication/authorization 与 human-actor audit model 由 `dify-enterprise` 拥有，本设计对它们的描述是 external delivery context；
- `tasks.md` 中的 EE task 是带目标 repository 和 upstream dependency 的 external delivery checklist；
- EE handwritten/generated source 必须只提交到 `dify-enterprise`，不得放入 Dify repository。
- EE implementation 开始前必须在 `dify-enterprise` repository 建立并链接 repo-owned delivery artifact；Dify 中的 coordination checklist 不能作为 EE source 的 repo-local apply 或 archive owner。

## Goals / Non-Goals

**Goals:**

- 在EE Dashboard提供API summary定义的完整Kratos HTTP admin surface。
- 复用EE现有`difyclient`依赖方向，把所有Human Input command/query转发到Dify internal HTTP API。
- 保证EE与Dify workspace两个transport入口汇入同一个Dify Python application service。
- 保留CAS、secret replace-or-preserve语义、latest-only pagination、typed diagnostic和Contact/binding owner semantics；EE public Protobuf使用独立credential update/response messages，并把existing integration中省略的secret映射为Dify internal preserve command。
- 对authentication、EE-owned human-actor audit、operation/correlation tracking、timeout、error mapping、secret redaction和observability建立明确边界。

**Non-Goals:**

- 不在EE实现provider SDK adapter、directory sync worker、reconciler、integration aggregate或binding repository。
- 不为Human Input tables增加EE Ent mapping、raw SQL、cache或migration。
- 不修改CE/SaaS workspace业务语义，也不让Dify workspace controller调用EE Human Input API。
- 不实现Platform/External Contact lifecycle、workspace override、Email provider、member/workspace CRUD或自动同步。
- 不在本change实现Dify internal Human Input API；它是独立Dify change拥有的blocking upstream dependency。

## Decisions

### 1. Dify是Human Input IM control-plane的唯一业务owner

Dify application service拥有：

- Organization Contact projection与availability；
- integration credential persistence、CAS、rotation与replacement；
- provider adapter、directory pagination与reachability test；
- single-active manual run、Celery scheduling与retry；
- pure reconciliation与revision-guarded apply；
- identity/binding mutation和latest-only read model。

EE service只拥有Dashboard transport/authentication和Dify client orchestration。它不通过Ent或共享DB旁路Dify service，也不在Go中复制领域对象与状态机。

Organization Contact projection 使用 Dify `Account` 作为 source fact，并保持单一 Dify business owner，但交付边界拆分为两个 upstream changes：`initialize-human-input-contact-projection` 只负责版本升级运行的 `flask data-migrate human-input-contacts --apply` initialization；`implement-contact-projection-lifecycle-maintenance` 负责 authoritative Account create/profile-update write-through、availability 与独立 periodic reconciliation。Account disabled不修改或删除Contact，disabled或已删除Account对应Contact保留稳定ID但从current-state projection排除；同一Account重新active时复用原Contact，删除后以新Account ID重建的主体不得复用旧Contact。Organization Contact read与manual sync只消费current projection，不触发initialization或repair。

`Contact.created_at`继续表示Contact projection自身的创建时间。EE Contacts read model另行从`Account.created_at`投影`joined_at`；不得把backfill时间解释为Organization加入时间，也不得为此在Contact aggregate复制Account timestamp。

备选方案“EE直接读写Dify DB并运行Go worker”可以减少一次HTTP hop，但会产生第二套transaction、provider与reconciliation语义，且需要Python/Go双向schema compatibility；因此不采用。

### 2. EE API只使用Kratos HTTP transport

在`server/pkg/apis/enterprise/v1/human_input.proto`中定义`EnterpriseHumanInputAdmin`，保留API summary中的package、enum number、field number、JSON name、validation rule和`google.api.http` path。使用`make proto-gen WHAT=enterprise`生成Kratos HTTP bindings，并在`server/pkg/enterprise/server/http.go`调用对应`RegisterEnterpriseHumanInputAdminHTTPServer`。

本change不把service注册到enterprise gRPC server，不增加grpc-gateway process，也不设计HTTP到gRPC的转发层。`service/human_input.go`直接实现generated Kratos service interface。

### 3. Dify提供独立trusted internal HTTP surface

EE不能复用workspace console endpoint，因为两者的actor、authorization和scope不同。Dify upstream change应在既有`/inner/api/enterprise/*` authentication boundary下提供：

| Operation | Internal HTTP endpoint |
| --- | --- |
| List Organization Contacts | `GET /inner/api/enterprise/human-input/contacts` |
| Get/Upsert/Delete Integration | `GET/PUT/DELETE /inner/api/enterprise/human-input/im-integration` |
| Test Integration | `POST /inner/api/enterprise/human-input/im-integration/test` |
| Create Manual Run | `POST /inner/api/enterprise/human-input/im-sync-runs` |
| Get Latest Run | `GET /inner/api/enterprise/human-input/im-sync-runs/latest` |
| List Latest Results | `GET /inner/api/enterprise/human-input/im-sync-runs/latest/results` |
| List IM Identities | `GET /inner/api/enterprise/human-input/im-identities` |
| Create Binding | `POST /inner/api/enterprise/human-input/contacts/{contact_id}/im-bindings` |
| Delete Binding | `DELETE /inner/api/enterprise/human-input/contacts/{contact_id}/im-bindings/{binding_id}` |
| Test Binding | `POST /inner/api/enterprise/human-input/contacts/{contact_id}/im-bindings/{binding_id}/test` |

Dify internal JSON/Pydantic contract由Dify application command与read model拥有，并使用stable machine-readable error code。EE public Protobuf只暴露Dashboard所需字段，通过显式mapper适配internal contract；两个shape当前可以相同，但不得把一一同构设为长期约束。Dify internal controllers只做trusted-service authentication、DTO validation、operation/correlation metadata解析和application-service调用；不得重新实现workspace controller、EE actor audit或领域逻辑。

备选方案是让EE client调用public/workspace console API。该方案需要伪造workspace session/role，无法表达deployment-wide administrator actor，并会混淆workspace override与Organization binding，因此不采用。

### 4. Capability-local call graph必须无环

运行时调用图固定为：

```text
EE Dashboard
  -> EE Kratos HTTP service
  -> EE typed difyclient
  -> Dify internal HTTP controller
  -> Dify Human Input application service
  -> Dify Celery worker
  -> IM provider
```

Dify workspace入口使用另一条更短路径：

```text
Dify Workspace
  -> Dify Flask workspace controller
  -> Dify Human Input application service
```

两条路径在application service收敛。Dify internal controller、application service、repository、worker与provider adapter在本operation内不得调用EE Human Input API。Dify workspace controller也不得把请求代理给EE Kratos后再由EE调回Dify。

现有系统级双向依赖继续存在，但Human Input capability内只有`EE → Dify → Provider`方向；这避免了request recursion和业务ownership循环。

### 5. EE use case拥有admin audit/orchestration，typed Dify client隐藏HTTP机制

新增边界建议如下：

- `server/pkg/difyclient/apiv1/human_input.go`：typed internal request/response、`HumanInputControlPlaneClient`与HTTP implementation，拥有service authentication、timeout、safe-read retry和Dify error decoding；
- `server/pkg/enterprise/biz/human_input.go`：拥有admin command/query orchestration、operation/correlation ID、EE human-actor audit lifecycle、ambiguous mutation outcome与transport-neutral upstream error；
- `server/pkg/enterprise/service/human_input.go`：Protobuf mapping、defaulting、authenticated Dashboard User extraction和enterprise error mapping；
- `server/pkg/enterprise/server/http.go`与Wire provider set：Kratos HTTP registration与dependency injection。

Use case不解释provider response、不执行CAS，也不依赖Dify Ent、provider client或Human Input persistence。Mutation在调用Dify前写入或提交EE-owned audit start record，完成后记录success/rejected/unknown outcome；ambiguous timeout保持`unknown`并通过current-state read恢复，而不是blind retry。为测试提供fake `HumanInputControlPlaneClient`与audit recorder，service tests不得启动Dify DB或provider client。

### 6. EE独占human actor audit；Dify只接收operation/correlation metadata

Browser request不接受`actor_id`或`organization_id`。EE Kratos authentication/authorization拥有Dashboard User语义；use case在完成enterprise-administrator授权后，把EE User ID、operation、target、operation ID与outcome记录在EE-owned audit boundary。Typed client只向Dify传播operation/correlation ID，不传播EE User ID或其他human principal metadata。

EE-originated command在Dify中将`configured_by_account_id`、`started_by_account_id`、`bound_by_account_id`等Dify Account-specific字段留空；Dify workspace入口仍记录真实Dify Account。Dify只认证调用服务并记录service identity与correlation context，不建立EE User到Dify Account的映射。为保证不存在绕过EE audit的同权调用方，Human Input internal surface应使用EE-specific service credential、mTLS identity或等价的caller-scoped authentication，而不是依赖可被多个内部调用方共享的泛化actor assertion。

EE部署的Organization由deployment语义确定，不允许client选择其他Organization。若未来支持multi-Organization，必须先显式扩展domain与internal contract，不能复用任意header偷偷引入scope。

### 7. Secret与error boundary使用allow-list mapping

EE仅映射credential command，不读取existing secret。每个request/response mapper使用explicit field allow-list；通用JSON dump、raw upstream body logging与`fmt`输出Protobuf request均禁止用于secret-bearing method。

Dify internal error必须包含stable code和safe message。EE按code映射`400/404/409`等业务错误；expected provider diagnostic映射到typed status response；connection/timeout/malformed response映射为sanitized upstream failure。不得按message substring推断stale revision或binding conflict。

### 8. Retry policy按operation安全性区分

所有Dify call设置bounded timeout并传播correlation ID。GET query可以复用现有safe-read retry policy；mutation默认不blind retry：

- upsert/delete integration依赖CAS，timeout后调用方应重新GET current revision；
- binding mutation依赖Dify idempotency/owner predicate，只有contract明确后才能自动retry；
- create sync run虽然Dify提供single-active语义，EE仍优先在ambiguous timeout后引导读取latest run，而不是无限重放。

EE不增加distributed lock、mutation cache或compensation transaction。

### 9. Workspace surface与EE Dashboard surface保持职责分离

EE Dashboard是Organization integration/sync/binding管理入口。Dify workspace API继续拥有Contact picker、Platform/External Contact和workspace override。若workspace contract暴露共享的Organization read model，它直接调用Dify application service；若当前edition不允许workspace mutation，则在Dify policy boundary拒绝，而不是代理到EE Dashboard API。

这保证不会为了“复用EE admin API”形成`Dify → EE → Dify`链，也不会让EE admin endpoint接管workspace authorization。

## Risks / Trade-offs

- [新增一次EE到Dify HTTP hop] → 复用现有`difyclient`连接、authentication、timeout与observability；相比双实现，额外hop的复杂度和延迟更可控。
- [Dify internal与EE Protobuf contract漂移] → 维护语义contract tests，验证EE必需字段、enum、pagination与error-code mapping；不要求两个contract的非公共字段或整体shape一一同构。
- [现有系统双向依赖导致误用] → capability-level architecture test明确禁止Dify Human Input调用EE Human Input façade；license/edition/Organization capability仍可通过窄port或在entry/composition boundary预解析的policy snapshot提供，EE path继续禁止Human Input Ent/provider/worker依赖。
- [Mutation timeout产生不确定结果] → 不blind retry；通过GET current integration/latest run/refreshed Contact恢复确定状态。
- [Dify internal API不可用导致EE Dashboard不可用] → 返回sanitized upstream error并提供operation/latency/correlation metrics；不使用stale EE cache伪造current control-plane state。
- [EE human-actor audit与Dify mutation失配] → EE在发起mutation前记录actor与operation ID，按success/rejected/unknown完成outcome；Dify只记录caller service与同一correlation context，EE actor不进入Dify Account-specific字段。

## Migration Plan

1. 先完成 `complete-human-input-im-channel-management`、`integrate-im-contact-sync-runtime` 与 `complete-human-input-contact-binding-api` 的共享 application boundaries，再由独立 Dify change 落地 `/inner/api/enterprise/human-input/*` contract，并完成 workspace controller 共用 service 的验证。
2. 在EE repo增加Human Input Protobuf API、Kratos HTTP generated bindings与typed `difyclient`，使用fake upstream完成service/client tests。
3. 对Dify internal JSON/error contract与EE必需public fields执行语义cross-repo contract test，确认EE不需要Human Input Ent schema、worker或provider dependency，也不要求两个contract整体同构。
4. 注册Kratos HTTP service并在feature gate下部署，先验证read endpoint，再验证CAS mutation、manual sync和binding mutation。
5. 启用EE Dashboard入口，观察upstream latency/error、stale revision和ambiguous mutation timeout；Dify侧继续观察worker、provider与reconciliation指标。

回滚时关闭EE Human Input admin feature gate并移除HTTP registration即可。Dify control-plane数据与worker不回滚，EE没有本地Human Input state需要清理。

## Open Questions

- 无未决设计问题。Dify internal API 是本 change 的显式 blocking upstream dependency；在该 contract 冻结并落地前，EE 只能完成 fake-client 范围，不能宣称端到端 apply-ready。
