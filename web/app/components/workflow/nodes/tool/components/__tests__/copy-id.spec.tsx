import { act, fireEvent, render, screen } from '@testing-library/react'
import CopyId from '../copy-id'

const mockCopy = vi.fn()
let mockTranslationReturnsEmpty = false

vi.mock('copy-to-clipboard', () => ({
  default: (...args: unknown[]) => mockCopy(...args),
}))

vi.mock('react-i18next', async () => {
  const actual = await vi.importActual<typeof import('react-i18next')>('react-i18next')
  return {
    ...actual,
    useTranslation: () => ({
      t: (key: string) => mockTranslationReturnsEmpty ? '' : key,
    }),
  }
})

vi.mock('@/app/components/base/tooltip', () => ({
  default: ({ children, popupContent }: { children: React.ReactNode, popupContent?: React.ReactNode }) => (
    <div>
      <div data-testid="tooltip-content">{popupContent}</div>
      {children}
    </div>
  ),
}))

describe('CopyId', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.useFakeTimers()
    mockTranslationReturnsEmpty = false
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('should copy content after the debounced click handler runs', () => {
    render(<CopyId content="tool-node-id" />)

    act(() => {
      fireEvent.click(screen.getByText('tool-node-id'))
      vi.advanceTimersByTime(100)
    })

    expect(mockCopy).toHaveBeenCalledWith('tool-node-id')
  })

  it('should toggle tooltip feedback between copy and copied states', () => {
    render(<CopyId content="tool-node-id" />)

    expect(screen.getByTestId('tooltip-content')).toHaveTextContent(/embedded\.copy$/)

    act(() => {
      fireEvent.click(screen.getByText('tool-node-id'))
      vi.advanceTimersByTime(100)
    })

    expect(screen.getByTestId('tooltip-content')).toHaveTextContent(/embedded\.copied$/)

    act(() => {
      fireEvent.mouseLeave(screen.getByText('tool-node-id').closest('.inline-flex')!)
      vi.advanceTimersByTime(100)
    })

    expect(screen.getByTestId('tooltip-content')).toHaveTextContent(/embedded\.copy$/)
  })

  it('should stop click propagation from the wrapper container', () => {
    const parentClick = vi.fn()

    render(
      <div onClick={parentClick}>
        <CopyId content="tool-node-id" />
      </div>,
    )

    fireEvent.click(screen.getByText('tool-node-id').closest('.inline-flex')!)

    expect(parentClick).not.toHaveBeenCalled()
  })

  it('should fall back to an empty tooltip when translations resolve to empty strings', () => {
    mockTranslationReturnsEmpty = true

    render(<CopyId content="tool-node-id" />)

    expect(screen.getByTestId('tooltip-content')).toBeEmptyDOMElement()
  })
})
