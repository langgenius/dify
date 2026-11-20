import { screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { NuqsTestingAdapter } from 'nuqs/adapters/testing'
import { useState } from 'react'
import { createConsoleQueryClient, seedFeatures } from '@/test/console/query-data'
import { renderWorkflowComponent } from '../../../../__tests__/workflow-test-env'
import { VersionHistoryContextMenuOptions } from '../../../../types'
import ActionMenu from '../index'

let versionRestoreAccess = {
  version_restore_enabled: true,
  version_restore_upgrade_available: false,
}

const renderActionMenu = (ui: React.ReactElement, pipelineId?: string) => {
  const queryClient = createConsoleQueryClient()
  seedFeatures(queryClient, versionRestoreAccess)
  return renderWorkflowComponent(<NuqsTestingAdapter>{ui}</NuqsTestingAdapter>, {
    queryClient,
    resource: pipelineId
      ? { kind: 'knowledge-pipeline', pipelineId }
      : { kind: 'app', appId: 'app-1', mode: 'workflow' },
  })
}

afterEach(() => vi.unstubAllGlobals())

describe('ActionMenu', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    versionRestoreAccess = {
      version_restore_enabled: true,
      version_restore_upgrade_available: false,
    }
  })

  it('closes the menu before invoking the selected action with focus on its trigger', async () => {
    const user = userEvent.setup()
    const onAction = vi.fn(() =>
      expect(screen.getByRole('button', { name: 'common.operation.more' })).toHaveFocus(),
    )
    function Harness() {
      const [open, setOpen] = useState(false)
      return (
        <ActionMenu
          workflowId="version-1"
          isNamedVersion
          isShowDelete
          canImportExportDSL
          open={open}
          setOpen={setOpen}
          handleClickActionMenuItem={onAction}
        />
      )
    }
    renderActionMenu(<Harness />)
    const trigger = screen.getByRole('button', { name: 'common.operation.more' })
    for (const [name, action] of [
      ['workflow.common.restore', VersionHistoryContextMenuOptions.restore],
      ['common.operation.delete', VersionHistoryContextMenuOptions.delete],
    ] as const) {
      await user.click(trigger)
      await user.click(screen.getByRole('menuitem', { name }))
      await waitFor(() => expect(screen.queryByRole('menu')).not.toBeInTheDocument())
      expect(onAction).toHaveBeenLastCalledWith(action)
    }
    expect(onAction).toHaveBeenCalledTimes(2)
  })

  it.each([
    { pipelineId: 'pipeline-1', canImportExportDSL: true },
    { pipelineId: undefined, canImportExportDSL: false },
  ])('omits export outside permitted app workflows: %j', ({ pipelineId, canImportExportDSL }) => {
    renderActionMenu(
      <ActionMenu
        workflowId="version-1"
        isNamedVersion={false}
        isShowDelete={false}
        canImportExportDSL={canImportExportDSL}
        open
        setOpen={vi.fn()}
        handleClickActionMenuItem={vi.fn()}
      />,
      pipelineId,
    )
    expect(screen.queryByRole('menuitem', { name: 'app.exportApp' })).not.toBeInTheDocument()
    expect(
      screen.getByRole('menuitem', { name: 'workflowHistory.versionHistory.nameThisVersion' }),
    ).toBeInTheDocument()
    expect(
      screen.queryByRole('menuitem', { name: 'common.operation.delete' }),
    ).not.toBeInTheDocument()
  })

  it('keeps upgrade badges within one menu action when the workspace can upgrade into restore', async () => {
    const user = userEvent.setup()
    const handleClickActionMenuItem = vi.fn()
    const trackUpgrade = vi.fn()
    vi.stubGlobal('gtag', trackUpgrade)
    versionRestoreAccess = {
      version_restore_enabled: false,
      version_restore_upgrade_available: true,
    }

    renderActionMenu(
      <ActionMenu
        workflowId="version-1"
        isNamedVersion
        isShowDelete
        canImportExportDSL
        open
        setOpen={vi.fn()}
        handleClickActionMenuItem={handleClickActionMenuItem}
      />,
    )

    expect(
      screen.queryByRole('button', { name: 'billing.upgradeBtn.encourageShort' }),
    ).not.toBeInTheDocument()
    const restore = screen.getByRole('menuitem', { name: /workflow.common.restore/ })
    expect(restore).toHaveTextContent('billing.upgradeBtn.encourageShort')
    await user.click(
      screen.getAllByText('billing.upgradeBtn.encourageShort', { selector: 'span' })[0]!,
    )
    expect(handleClickActionMenuItem).toHaveBeenCalledExactlyOnceWith(
      VersionHistoryContextMenuOptions.restore,
    )
    expect(trackUpgrade).toHaveBeenCalledExactlyOnceWith('event', 'click_upgrade_btn', {
      loc: 'workflow-version-history-menu',
    })
  })
})
