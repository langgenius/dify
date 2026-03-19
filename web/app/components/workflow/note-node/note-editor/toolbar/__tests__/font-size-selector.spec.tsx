import { fireEvent, render, screen } from '@testing-library/react'
import FontSizeSelector from '../font-size-selector'

const {
  mockHandleFontSize,
  mockHandleOpenFontSizeSelector,
} = vi.hoisted(() => ({
  mockHandleFontSize: vi.fn(),
  mockHandleOpenFontSizeSelector: vi.fn(),
}))

let mockFontSizeSelectorShow = false
let mockFontSize = '12px'

vi.mock('../hooks', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../hooks')>()
  return {
    ...actual,
    useFontSize: () => ({
      fontSize: mockFontSize,
      fontSizeSelectorShow: mockFontSizeSelectorShow,
      handleFontSize: mockHandleFontSize,
      handleOpenFontSizeSelector: mockHandleOpenFontSizeSelector,
    }),
  }
})

describe('NoteEditor FontSizeSelector', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockFontSizeSelectorShow = false
    mockFontSize = '12px'
  })

  it('should show the current font size label and request opening when clicked', () => {
    render(<FontSizeSelector />)

    fireEvent.click(screen.getByText('workflow.nodes.note.editor.small'))

    expect(mockHandleOpenFontSizeSelector).toHaveBeenCalledWith(true)
  })

  it('should select a new font size and close the popup', () => {
    mockFontSizeSelectorShow = true
    mockFontSize = '14px'

    render(<FontSizeSelector />)

    fireEvent.click(screen.getByText('workflow.nodes.note.editor.large'))

    expect(screen.getAllByText('workflow.nodes.note.editor.medium').length).toBeGreaterThan(0)
    expect(mockHandleFontSize).toHaveBeenCalledWith('16px')
    expect(mockHandleOpenFontSizeSelector).toHaveBeenCalledWith(false)
  })
})
