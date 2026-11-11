import type { IChatItem } from '../../type'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import Log from '../index'

const logItem: IChatItem = {
  id: 'message-1',
  content: 'Answer',
  isAnswer: true,
  workflow_run_id: 'run-1',
}

describe('Log', () => {
  it('sends the selected item to its owner without activating the surrounding surface', async () => {
    const user = userEvent.setup()
    const onOpenLog = vi.fn()
    const onParentClick = vi.fn()
    render(
      <div role="presentation" onClick={onParentClick}>
        <Log logItem={logItem} onOpenLog={onOpenLog} />
      </div>,
    )

    await user.click(screen.getByRole('button', { name: /operation\.log/ }))

    expect(onOpenLog).toHaveBeenCalledExactlyOnceWith(logItem)
    expect(onParentClick).not.toHaveBeenCalled()
  })
})
