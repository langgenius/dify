import * as hooks from '../index'

describe('workflow-app hooks index', () => {
  it('should re-export workflow-app hooks', () => {
    expect(hooks.useAvailableNodesMetaData).toBeTypeOf('function')
    expect(hooks.useConfigsMap).toBeTypeOf('function')
    expect(hooks.useDSL).toBeTypeOf('function')
    expect(hooks.useGetRunAndTraceUrl).toBeTypeOf('function')
    expect(hooks.useInspectVarsCrud).toBeTypeOf('function')
    expect(hooks.useIsChatMode).toBeTypeOf('function')
    expect(hooks.useNodesSyncDraft).toBeTypeOf('function')
    expect(hooks.useWorkflowInit).toBeTypeOf('function')
    expect(hooks.useWorkflowRefreshDraft).toBeTypeOf('function')
    expect(hooks.useWorkflowRun).toBeTypeOf('function')
    expect(hooks.useWorkflowStartRun).toBeTypeOf('function')
    expect(hooks.useWorkflowTemplate).toBeTypeOf('function')
  })
})
