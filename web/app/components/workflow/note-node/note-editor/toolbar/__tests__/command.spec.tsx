import { fireEvent, render } from '@testing-library/react'
import Command from '../command'

const { mockHandleCommand } = vi.hoisted(() => ({
  mockHandleCommand: vi.fn(),
}))

let mockSelectedState = {
  selectedIsBold: false,
  selectedIsItalic: false,
  selectedIsStrikeThrough: false,
  selectedIsLink: false,
  selectedIsBullet: false,
}

vi.mock('../../store', () => ({
  useStore: (selector: (state: typeof mockSelectedState) => unknown) => selector(mockSelectedState),
}))

vi.mock('../hooks', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../hooks')>()
  return {
    ...actual,
    useCommand: () => ({
      handleCommand: mockHandleCommand,
    }),
  }
})

describe('NoteEditor Command', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockSelectedState = {
      selectedIsBold: false,
      selectedIsItalic: false,
      selectedIsStrikeThrough: false,
      selectedIsLink: false,
      selectedIsBullet: false,
    }
  })

  it('should highlight the active command and dispatch it on click', () => {
    mockSelectedState.selectedIsBold = true
    const { container } = render(<Command type="bold" />)

    const trigger = container.querySelector('.cursor-pointer') as HTMLElement

    expect(trigger).toHaveClass('bg-state-accent-active')

    fireEvent.click(trigger)

    expect(mockHandleCommand).toHaveBeenCalledWith('bold')
  })

  it('should keep inactive commands unhighlighted', () => {
    const { container } = render(<Command type="link" />)

    const trigger = container.querySelector('.cursor-pointer') as HTMLElement

    expect(trigger).not.toHaveClass('bg-state-accent-active')
  })
})
