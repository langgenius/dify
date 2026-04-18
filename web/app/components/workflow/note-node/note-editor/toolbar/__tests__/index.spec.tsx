import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { NoteTheme } from '../../../types'
import Toolbar from '../index'

const {
  mockHandleCommand,
  mockHandleFontSize,
  mockHandleOpenFontSizeSelector,
} = vi.hoisted(() => ({
  mockHandleCommand: vi.fn(),
  mockHandleFontSize: vi.fn(),
  mockHandleOpenFontSizeSelector: vi.fn(),
}))

let mockFontSizeSelectorShow = false
let mockFontSize = '14px'
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
    useFontSize: () => ({
      fontSize: mockFontSize,
      fontSizeSelectorShow: mockFontSizeSelectorShow,
      handleFontSize: mockHandleFontSize,
      handleOpenFontSizeSelector: mockHandleOpenFontSizeSelector,
    }),
  }
})

describe('NoteEditor Toolbar', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockFontSizeSelectorShow = false
    mockFontSize = '14px'
    mockSelectedState = {
      selectedIsBold: false,
      selectedIsItalic: false,
      selectedIsStrikeThrough: false,
      selectedIsLink: false,
      selectedIsBullet: false,
    }
  })

  it('should compose the toolbar controls and forward callbacks from color and operator actions', async () => {
    const onCopy = vi.fn()
    const onDelete = vi.fn()
    const onDuplicate = vi.fn()
    const onShowAuthorChange = vi.fn()
    const onThemeChange = vi.fn()
    const { container } = render(
      <Toolbar
        theme={NoteTheme.blue}
        onThemeChange={onThemeChange}
        onCopy={onCopy}
        onDuplicate={onDuplicate}
        onDelete={onDelete}
        showAuthor={false}
        onShowAuthorChange={onShowAuthorChange}
      />,
    )

    expect(screen.getByText('workflow.nodes.note.editor.medium')).toBeInTheDocument()

    const triggers = container.querySelectorAll('[data-state="closed"]')

    fireEvent.click(triggers[0] as HTMLElement)

    const colorOptions = document.body.querySelectorAll('[role="tooltip"] .group.relative')

    fireEvent.click(colorOptions[colorOptions.length - 1] as Element)

    expect(onThemeChange).toHaveBeenCalledWith(NoteTheme.violet)

    fireEvent.click(screen.getByRole('button', { name: 'common.operation.more' }))
    fireEvent.click(screen.getByText('workflow.common.copy'))

    expect(onCopy).toHaveBeenCalledTimes(1)

    await waitFor(() => {
      expect(document.body.querySelector('[role="tooltip"]')).not.toBeInTheDocument()
    })
    expect(onDelete).not.toHaveBeenCalled()
    expect(onDuplicate).not.toHaveBeenCalled()
    expect(onShowAuthorChange).not.toHaveBeenCalled()
  })
})
