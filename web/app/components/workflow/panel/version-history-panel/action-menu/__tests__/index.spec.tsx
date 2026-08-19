import type { CloudPlan } from '@dify/contracts/api/console/features/types.gen'
import { screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { createConsoleQueryClient, seedSystemFeatures } from '@/test/console/query-data'
import { renderWorkflowComponent } from '../../../../__tests__/workflow-test-env'
import { VersionHistoryContextMenuOptions } from '../../../../types'
import ActionMenu from '../index'

const renderActionMenu = (ui: React.ReactElement) => {
  const queryClient = createConsoleQueryClient()
  seedSystemFeatures(queryClient, { deployment_edition: 'CLOUD' })
  return renderWorkflowComponent(ui, { queryClient })
}

vi.mock('@/config', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/config')>()
  return {
    ...actual,
  }
})

let mockPlanType: CloudPlan = 'professional'
let mockEnableBilling = true

vi.mock('@/context/provider-context', () => ({
  useProviderContext: () => ({
    plan: { type: mockPlanType },
    enableBilling: mockEnableBilling,
  }),
}))

describe('ActionMenu', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockPlanType = 'professional'
    mockEnableBilling = true
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

    await user.click(trigger)
    await user.click(screen.getByText('workflow.common.restore'))
    await user.click(screen.getByText('common.operation.delete'))

    expect(setOpen).toHaveBeenCalled()
    expect(handleClickActionMenuItem).toHaveBeenCalledWith(
      VersionHistoryContextMenuOptions.restore,
      VersionHistoryContextMenuOptions.restore,
    )
    expect(handleClickActionMenuItem).toHaveBeenCalledWith(
      VersionHistoryContextMenuOptions.delete,
      VersionHistoryContextMenuOptions.delete,
    )
  })

  it('shows upgrade buttons beside restore and export for sandbox users', async () => {
    const user = userEvent.setup()
    const handleClickActionMenuItem = vi.fn()
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

    const upgradeButtons = screen.getAllByRole('button', {
      name: 'billing.upgradeBtn.encourageShort',
    })
    expect(upgradeButtons).toHaveLength(2)

    await user.click(upgradeButtons[0]!)

    expect(handleClickActionMenuItem).not.toHaveBeenCalled()
  })
})
