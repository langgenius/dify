import type { CloudPlan } from '@dify/contracts/api/console/features/types.gen'
import { screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { NuqsTestingAdapter } from 'nuqs/adapters/testing'
import {
  createConsoleQueryClient,
  seedFeatures,
  seedSystemFeatures,
} from '@/test/console/query-data'
import { renderWorkflowComponent } from '../../../../__tests__/workflow-test-env'
import { VersionHistoryContextMenuOptions } from '../../../../types'
import ActionMenu from '../index'

let mockPlanType: CloudPlan = 'professional'
let deploymentEdition: 'CLOUD' | 'COMMUNITY' = 'CLOUD'

const renderActionMenu = (ui: React.ReactElement, pipelineId?: string) => {
  const queryClient = createConsoleQueryClient()
  seedFeatures(queryClient, { billing: { subscription: { plan: mockPlanType } } })
  seedSystemFeatures(queryClient, { deployment_edition: deploymentEdition })
  return renderWorkflowComponent(<NuqsTestingAdapter>{ui}</NuqsTestingAdapter>, {
    queryClient,
    initialStoreState: { pipelineId },
  })
}

vi.mock('@/config', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/config')>()
  return {
    ...actual,
  }
})

describe('ActionMenu', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockPlanType = 'professional'
    deploymentEdition = 'CLOUD'
  })

  it('toggles the trigger and forwards menu clicks', async () => {
    const user = userEvent.setup()
    const setOpen = vi.fn()
    const handleClickActionMenuItem = vi.fn()

    renderActionMenu(
      <ActionMenu
        workflowId="version-1"
        isNamedVersion
        isShowDelete
        canImportExportDSL
        open
        setOpen={setOpen}
        handleClickActionMenuItem={handleClickActionMenuItem}
      />,
    )

    const trigger = screen.getByRole('button', { name: 'common.operation.more' })
    expect(trigger).not.toHaveAttribute('role')
    handleClickActionMenuItem.mockImplementation(() => expect(trigger).toHaveFocus())

    await user.click(trigger)
    await user.click(screen.getByText('workflow.common.restore'))
    await user.click(screen.getByText('common.operation.delete'))

    expect(setOpen).toHaveBeenCalled()
    expect(handleClickActionMenuItem).toHaveBeenCalledWith(VersionHistoryContextMenuOptions.restore)
    expect(handleClickActionMenuItem).toHaveBeenCalledWith(VersionHistoryContextMenuOptions.delete)
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

  it('keeps upgrade badges within one menu action for sandbox users', async () => {
    const user = userEvent.setup()
    const handleClickActionMenuItem = vi.fn()
    const trackUpgrade = vi.fn()
    vi.stubGlobal('gtag', trackUpgrade)
    mockPlanType = 'sandbox'

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
    vi.unstubAllGlobals()
  })
})
