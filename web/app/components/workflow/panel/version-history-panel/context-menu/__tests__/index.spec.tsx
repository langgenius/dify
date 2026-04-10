import { screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { renderWorkflowComponent } from '../../../../__tests__/workflow-test-env'
import { VersionHistoryContextMenuOptions } from '../../../../types'
import ContextMenu from '../index'

describe('ContextMenu', () => {
  it('toggles the trigger and forwards menu clicks', async () => {
    const user = userEvent.setup()
    const setOpen = vi.fn()
    const handleClickMenuItem = vi.fn()

    renderWorkflowComponent(
      <ContextMenu
        isNamedVersion
        isShowDelete
        open
        setOpen={setOpen}
        handleClickMenuItem={handleClickMenuItem}
      />,
    )

    await user.click(screen.getByRole('button'))
    await user.click(screen.getByText('workflow.common.restore'))
    await user.click(screen.getByText('common.operation.delete'))

    expect(setOpen).toHaveBeenCalled()
    expect(handleClickMenuItem).toHaveBeenCalledWith(
      VersionHistoryContextMenuOptions.restore,
      VersionHistoryContextMenuOptions.restore,
    )
    expect(handleClickMenuItem).toHaveBeenCalledWith(
      VersionHistoryContextMenuOptions.delete,
      VersionHistoryContextMenuOptions.delete,
    )
  })
})
