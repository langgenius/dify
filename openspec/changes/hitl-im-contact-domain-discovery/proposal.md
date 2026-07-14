## Why

`HITL：IM 通知与 Contact` 这份 PRD 同时包含已确认规则、`BLOCKER` 决策更新和仍未收敛的问题，涉及联系人分类、通知投递、审批身份、审计与访问控制等多个主题。如果在这些语义尚未被清晰拆开前直接进入实现，产品、架构、安全和研发很容易把不同理解固化进同一变更里。

## What Changes

- 将 PRD 中已经明确的业务参与者、目标、事实与生命周期规则整理为可追溯的 OpenSpec 产物。
- 将未经确认的假设、语义缺口和跨章节冲突单独标识出来，作为实现前必须收敛的前置问题。
- 在不设计实现方案的前提下，为联系人治理、通知对象解析与审批访问控制三个能力域建立需求级规格。
- 显式区分配置态 recipient、运行时审批主体、通知落点与身份凭证，避免后续实现把它们混成同一个业务对象。

## Capabilities

### New Capabilities
- `contact-directory-governance`：定义 HITL 联系人的类型、部署形态作用域、成员生命周期、workspace 收录规则与 IM 身份归属规则。
- `hitl-recipient-resolution`：定义静态联系人、一次性邮箱、动态邮箱、current initiator、去重归并与通知渠道的运行时规则。
- `hitl-approval-access-control`：定义审批访问、提交资格、审计要求、URL 与 OTP 校验规则以及并发提交语义。

### Modified Capabilities
- 无。

## Impact

- 在 `/Users/qg/workspace/langgenius/openspec-store/openspec/changes/hitl-im-contact-domain-discovery/` 下新增一组规划产物。
- 为产品、架构、安全和 SaaS 团队提供一份在实现前必须收敛的领域事实、冲突和待回答问题清单。
- 为后续 HITL、Contact、通知和审批链路的实现规划建立统一业务基线，但本 change 本身只做领域发现与需求澄清。
