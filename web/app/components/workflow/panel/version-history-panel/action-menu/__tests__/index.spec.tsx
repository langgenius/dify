import { screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { renderWorkflowComponent } from '../../../../__tests__/workflow-test-env'
import { VersionHistoryContextMenuOptions } from '../../../../types'
import ActionMenu from '../index'

describe('ActionMenu', () => {
  it('toggles the trigger and forwards menu clicks', async () => {
    const user = userEvent.setup()
    const setOpen = vi.fn()
    const handleClickActionMenuItem = vi.fn()

    renderWorkflowComponent(
      <ActionMenu
        isNamedVersion
        isShowDelete
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
})
