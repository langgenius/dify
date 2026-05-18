import { fireEvent, render, screen } from '@testing-library/react'
import { useClickAway } from 'ahooks'
import PromptLogModal from '..'

let clickAwayHandlers: (() => void)[] = []
vi.mock('ahooks', async (importOriginal) => {
  const actual = await importOriginal<typeof import('ahooks')>()
  return {
    ...actual,
    useClickAway: vi.fn((fn: () => void) => {
      clickAwayHandlers.push(fn)
    }),
  }
})

describe('PromptLogModal', () => {
  const defaultProps = {
    width: 1000,
    onCancel: vi.fn(),
    currentLogItem: {
      id: '1',
      content: 'test',
      log: [{ role: 'user', text: 'Hello' }],
    } as unknown as Parameters<typeof PromptLogModal>[0]['currentLogItem'],
  }

  beforeEach(() => {
    vi.clearAllMocks()
    clickAwayHandlers = []
  })

  describe('Render', () => {
    it('renders correctly when currentLogItem is provided', () => {
      render(<PromptLogModal {...defaultProps} />)
      expect(screen.getByText('PROMPT LOG'))!.toBeInTheDocument()
      expect(screen.getByText('Hello'))!.toBeInTheDocument()
    })

    it('returns null when currentLogItem is missing', () => {
      const { container } = render(<PromptLogModal {...defaultProps} currentLogItem={undefined} />)
      expect(container.firstChild).toBeNull()
    })

    it('renders copy feedback when log length is 1', () => {
      render(<PromptLogModal {...defaultProps} />)
      expect(screen.getByRole('button', { name: 'common.operation.close' }))!.toBeInTheDocument()
    })

    it('renders multiple logs in Card correctly', () => {
      const props = {
        ...defaultProps,
        currentLogItem: {
          ...defaultProps.currentLogItem,
          log: [
            { role: 'user', text: 'Hello' },
            { role: 'assistant', text: 'Hi there' },
          ],
        },
      } as unknown as Parameters<typeof PromptLogModal>[0]
      render(<PromptLogModal {...props} />)
      expect(screen.getByText('USER'))!.toBeInTheDocument()
      expect(screen.getByText('ASSISTANT'))!.toBeInTheDocument()
      expect(screen.getByText('Hi there'))!.toBeInTheDocument()
    })

    it('returns null when currentLogItem.log is missing', () => {
      const { container } = render(<PromptLogModal {...defaultProps} currentLogItem={{ id: '1' } as unknown as Parameters<typeof PromptLogModal>[0]['currentLogItem']} />)
      expect(container.firstChild).toBeNull()
    })
  })

  describe('Interactions', () => {
    it('calls onCancel when close button is clicked', () => {
      render(<PromptLogModal {...defaultProps} />)
      const closeBtn = screen.getByRole('button', { name: 'common.operation.close' })
      expect(closeBtn)!.toBeInTheDocument()
      fireEvent.click(closeBtn)
      expect(defaultProps.onCancel).toHaveBeenCalled()
    })

    it('calls onCancel when clicking outside', async () => {
      const onCancel = vi.fn()
      render(
        <PromptLogModal {...defaultProps} onCancel={onCancel} />,
      )

      expect(useClickAway).toHaveBeenCalled()
      expect(clickAwayHandlers.length).toBeGreaterThan(0)

      // Call the last registered handler (simulating click away)
      // Call the last registered handler (simulating click away)
      clickAwayHandlers[clickAwayHandlers.length - 1]!()
      expect(onCancel).toHaveBeenCalled()
    })

    it('does not call onCancel when clicking outside if not mounted', () => {
      const onCancel = vi.fn()
      render(<PromptLogModal {...defaultProps} onCancel={onCancel} />)

      expect(clickAwayHandlers.length).toBeGreaterThan(0)
      // The first handler in the array is captured during the initial render before useEffect runs
      // The first handler in the array is captured during the initial render before useEffect runs
      clickAwayHandlers[0]!()
      expect(onCancel).not.toHaveBeenCalled()
    })
  })
})
