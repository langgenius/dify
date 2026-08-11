# IM Contact Sync coverage scope

`im_contact_sync_coverage_scope.json` 是此 change 的固定 coverage denominator。`project` 明确列出本 change 新增或修改的全部 production Python modules；unit 与 integration gate 必须分别使用这一相同列表，不能用 merged coverage 替代任一独立 gate。

`planner` 有意只包含 side-effect-free plan-generation module。其余 `project` modules 不属于 planner gate，因为它们拥有 HTTP、application orchestration、persistence、migration、locking、worker 或 shared-domain 职责；它们由独立的 project unit/integration gate 覆盖。`check_coverage_gate.py`、scope manifest 和本说明属于开发期 gate tooling，不是 production module，因此不进入 `project` denominator。

Transport-neutral application errors 与所有 forward migration revisions 都属于 production scope。新增错误模块或 migration 时，必须同步加入 manifest，并分别由 unit 与 integration coverage JSON 提供文件级数据。

Account、authentication 与 membership modules 不在 `project` 中，因为本 change 不再修改这些 production paths，也不要求这些写入获取 Organization IM write lock。

Coverage JSON 必须包含 scope 中的每个文件。文件缺失、重复、路径不存在或阈值不足都会使 gate 失败。
