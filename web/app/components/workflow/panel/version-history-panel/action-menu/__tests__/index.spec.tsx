import { screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { Plan } from '@/app/components/billing/type'
import { renderWorkflowComponent } from '../../../../__tests__/workflow-test-env'
import { VersionHistoryContextMenuOptions } from '../../../../types'
import ActionMenu from '../index'

vi.mock('@/config', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/config')>()
  return {
    ...actual,
    IS_CLOUD_EDITION: true,
  }
})

let mockPlanType = Plan.professional
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
    mockPlanType = Plan.professional
    mockEnableBilling = true
  })

  it('toggles the trigger and forwards menu clicks', async () => {
    const user = userEvent.setup()
    const setOpen = vi.fn()
    const handleClickActionMenuItem = vi.fn()

    renderWorkflowComponent(
      <ActionMenu
        isNamedVersion
        isShowDelete
        canImportExportDSL
        open
        setOpen={setOpen}
        handleClickActionMenuItem={handleClickActionMenuItem}
      />,
    )

    await user.click(screen.getByRole('button'))
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
    mockPlanType = Plan.sandbox

    renderWorkflowComponent(
      <ActionMenu
        isNamedVersion
        isShowDelete
        canImportExportDSL
        open
        setOpen={vi.fn()}
        handleClickActionMenuItem={handleClickActionMenuItem}
      />,
    )

    const upgradeButtons = screen.getAllByRole('button', { name: 'billing.upgradeBtn.encourageShort' })
    expect(upgradeButtons).toHaveLength(2)

    await user.click(upgradeButtons[0]!)

    expect(handleClickActionMenuItem).not.toHaveBeenCalled()
  })
})
