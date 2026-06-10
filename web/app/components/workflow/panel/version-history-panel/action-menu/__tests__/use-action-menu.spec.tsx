import { renderWorkflowHook } from '../../../../__tests__/workflow-test-env'
import { VersionHistoryContextMenuOptions } from '../../../../types'
import useActionMenu from '../use-action-menu'

describe('useActionMenu', () => {
  it('returns restore, edit, export, copy and delete operations for app workflows', () => {
    const { result } = renderWorkflowHook(() => useActionMenu({
      isNamedVersion: true,
      isShowDelete: false,
      open: false,
      setOpen: vi.fn(),
      handleClickActionMenuItem: vi.fn(),
    }))

    expect(result.current.deleteOperation).toEqual({
      key: VersionHistoryContextMenuOptions.delete,
      name: 'common.operation.delete',
    })
    expect(result.current.options.map(item => item.key)).toEqual([
      VersionHistoryContextMenuOptions.restore,
      VersionHistoryContextMenuOptions.edit,
      VersionHistoryContextMenuOptions.exportDSL,
      VersionHistoryContextMenuOptions.copyId,
    ])
  })

  it('omits export for pipelines and renames the edit action for unnamed versions', () => {
    const { result } = renderWorkflowHook(() => useActionMenu({
      isNamedVersion: false,
      isShowDelete: true,
      open: false,
      setOpen: vi.fn(),
      handleClickActionMenuItem: vi.fn(),
    }), {
      initialStoreState: {
        pipelineId: 'pipeline-1',
      },
    })

    expect(result.current.options).toEqual([
      {
        key: VersionHistoryContextMenuOptions.restore,
        name: 'workflow.common.restore',
      },
      {
        key: VersionHistoryContextMenuOptions.edit,
        name: 'workflow.versionHistory.nameThisVersion',
      },
      {
        key: VersionHistoryContextMenuOptions.copyId,
        name: 'workflow.versionHistory.copyId',
      },
    ])
  })
})
