import { act, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import copy from 'copy-to-clipboard'
import CopyId from '../copy-id'

vi.mock('copy-to-clipboard', () => ({ default: vi.fn(() => true) }))

describe('tool/copy-id', () => {
  beforeEach(() => vi.useFakeTimers({ shouldAdvanceTime: true }))
  afterEach(() => {
    vi.clearAllTimers()
    vi.useRealTimers()
  })

  it('copies the tool ID without activating its parent, and resets feedback on leaving', async () => {
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime })
    const onParentClick = vi.fn()
    render(
      <div role="presentation" onClick={onParentClick}>
        <CopyId content="tool-123" />
      </div>,
    )
    const trigger = screen.getByRole('button', {
      name: 'appOverview.overview.appInfo.embedded.copy',
    })

    await user.click(trigger)
    act(() => vi.advanceTimersByTime(100))
    expect(copy).toHaveBeenCalledWith('tool-123')
    expect(onParentClick).not.toHaveBeenCalled()
    expect(trigger).toHaveAccessibleName('appOverview.overview.appInfo.embedded.copied')

    await user.unhover(trigger)
    act(() => vi.advanceTimersByTime(100))
    expect(trigger).toHaveAccessibleName('appOverview.overview.appInfo.embedded.copy')
  })
})
