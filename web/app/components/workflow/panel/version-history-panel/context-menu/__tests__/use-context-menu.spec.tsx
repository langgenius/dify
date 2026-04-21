import { renderWorkflowHook } from '../../../../__tests__/workflow-test-env'
import { VersionHistoryContextMenuOptions } from '../../../../types'
import useContextMenu from '../use-context-menu'

describe('useContextMenu', () => {
  it('returns restore, edit, export, copy and delete operations for app workflows', () => {
    const { result } = renderWorkflowHook(() => useContextMenu({
      isNamedVersion: true,
      isShowDelete: false,
      open: false,
      setOpen: vi.fn(),
      handleClickMenuItem: vi.fn(),
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
    const { result } = renderWorkflowHook(() => useContextMenu({
      isNamedVersion: false,
      isShowDelete: true,
      open: false,
      setOpen: vi.fn(),
      handleClickMenuItem: vi.fn(),
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
