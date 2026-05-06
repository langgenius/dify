import { act, fireEvent, render, screen } from '@testing-library/react'
import copy from 'copy-to-clipboard'
import CopyId from '../copy-id'

vi.mock('copy-to-clipboard', () => ({
  default: vi.fn(() => true),
}))

describe('tool/copy-id', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.useFakeTimers()
  })

  afterEach(() => {
    vi.runOnlyPendingTimers()
    vi.useRealTimers()
  })

  it('should copy content and reset copied state when mouse leaves', () => {
    const { container } = render(<CopyId content="tool-123" />)

    const trigger = screen.getByRole('button', { name: 'appOverview.overview.appInfo.embedded.copy' })
    const wrapper = container.querySelector('.inline-flex') as HTMLElement

    act(() => {
      fireEvent.click(trigger)
      vi.advanceTimersByTime(100)
    })
    expect(copy).toHaveBeenCalledWith('tool-123')
    expect(trigger).toHaveAccessibleName('appOverview.overview.appInfo.embedded.copied')

    act(() => {
      fireEvent.mouseLeave(wrapper)
      vi.advanceTimersByTime(100)
    })
    expect(trigger).toHaveAccessibleName('appOverview.overview.appInfo.embedded.copy')
  })

  it('should stop click propagation from the outer wrapper', () => {
    const handleParentClick = vi.fn()
    const { container } = render(
      <div onClick={handleParentClick}>
        <CopyId content="tool-123" />
      </div>,
    )

    fireEvent.click(container.querySelector('.inline-flex') as HTMLElement)

    expect(handleParentClick).not.toHaveBeenCalled()
  })
})
