import { act, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { UPDATE_DATASETS_EVENT_EMITTER } from '../../constants'
import ContextBlockComponent from './component'
// Mock the hooks used by ContextBlockComponent
const mockUseSelectOrDelete = vi.fn()
const mockUseTrigger = vi.fn()

vi.mock('../../hooks', () => ({
  useSelectOrDelete: (...args: unknown[]) => mockUseSelectOrDelete(...args),
  useTrigger: (...args: unknown[]) => mockUseTrigger(...args),
}))

// Mock event emitter context
const mockUseSubscription = vi.fn()
vi.mock('@/context/event-emitter', () => ({
  useEventEmitterContextContext: () => ({
    eventEmitter: {
      useSubscription: mockUseSubscription,
    },
  }),
}))

// Helpers
const defaultSetup = (overrides?: { isSelected?: boolean, open?: boolean }) => {
  const triggerSetOpen = vi.fn()
  mockUseSelectOrDelete.mockReturnValue([{ current: null }, overrides?.isSelected ?? false])
  mockUseTrigger.mockReturnValue([{ current: null }, overrides?.open ?? false, triggerSetOpen])
  return { triggerSetOpen }
}

const mockDatasets = [
  { id: '1', name: 'Dataset A', type: 'text' },
  { id: '2', name: 'Dataset B', type: 'text' },
]

describe('ContextBlockComponent', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  describe('Rendering', () => {
    it('should render without crashing', () => {
      defaultSetup()
      const { container } = render(
        <ContextBlockComponent nodeKey="test-key" onAddContext={vi.fn()} />,
      )
      expect(container.firstChild).toBeInTheDocument()
    })

    it('should display the context title', () => {
      defaultSetup()
      render(
        <ContextBlockComponent nodeKey="test-key" onAddContext={vi.fn()} />,
      )
      expect(screen.getByText('common.promptEditor.context.item.title')).toBeInTheDocument()
    })

    it('should display the dataset count', () => {
      defaultSetup()
      render(
        <ContextBlockComponent
          nodeKey="test-key"
          datasets={mockDatasets}
          onAddContext={vi.fn()}
        />,
      )
      expect(screen.getByText('2')).toBeInTheDocument()
    })

    it('should display zero count when no datasets provided', () => {
      defaultSetup()
      render(
        <ContextBlockComponent nodeKey="test-key" onAddContext={vi.fn()} />,
      )
      expect(screen.getByText('0')).toBeInTheDocument()
    })

    it('should render the file icon', () => {
      defaultSetup()
      render(
        <ContextBlockComponent nodeKey="test-key" onAddContext={vi.fn()} />,
      )
      // File05 icon renders as an SVG
      const fileIcon = screen.getByTestId('file-icon')
      expect(fileIcon).toBeInTheDocument()
    })
  })

  describe('Props', () => {
    it('should apply selected border class when isSelected is true', () => {
      defaultSetup({ isSelected: true })
      const { container } = render(
        <ContextBlockComponent nodeKey="test-key" onAddContext={vi.fn()} />,
      )
      expect(container.firstChild).toHaveClass('!border-[#9B8AFB]')
    })

    it('should not apply selected border class when isSelected is false', () => {
      defaultSetup({ isSelected: false })
      const { container } = render(
        <ContextBlockComponent nodeKey="test-key" onAddContext={vi.fn()} />,
      )
      expect(container.firstChild).not.toHaveClass('!border-[#9B8AFB]')
    })

    it('should apply open background class when dropdown is open', () => {
      defaultSetup({ open: true })
      const { container } = render(
        <ContextBlockComponent nodeKey="test-key" onAddContext={vi.fn()} />,
      )
      expect(container.firstChild).toHaveClass('bg-[#EBE9FE]')
    })

    it('should apply default background class when dropdown is closed', () => {
      defaultSetup({ open: false })
      const { container } = render(
        <ContextBlockComponent nodeKey="test-key" onAddContext={vi.fn()} />,
      )
      expect(container.firstChild).toHaveClass('bg-[#F4F3FF]')
    })

    it('should hide the portal trigger when canNotAddContext is true', () => {
      defaultSetup()
      render(
        <ContextBlockComponent
          nodeKey="test-key"
          datasets={mockDatasets}
          onAddContext={vi.fn()}
          canNotAddContext
        />,
      )
      // The dataset count badge should not be rendered
      expect(screen.queryByText('2')).not.toBeInTheDocument()
    })
  })

  describe('Dropdown Content', () => {
    it('should show dataset list when dropdown is open', () => {
      defaultSetup({ open: true })
      render(
        <ContextBlockComponent
          nodeKey="test-key"
          datasets={mockDatasets}
          onAddContext={vi.fn()}
        />,
      )
      expect(screen.getByText('Dataset A')).toBeInTheDocument()
      expect(screen.getByText('Dataset B')).toBeInTheDocument()
    })

    it('should show modal title with dataset count when open', () => {
      defaultSetup({ open: true })
      render(
        <ContextBlockComponent
          nodeKey="test-key"
          datasets={mockDatasets}
          onAddContext={vi.fn()}
        />,
      )
      expect(
        screen.getByText(/common\.promptEditor\.context\.modal\.title/),
      ).toBeInTheDocument()
    })

    it('should show the add context button when open', () => {
      defaultSetup({ open: true })
      render(
        <ContextBlockComponent
          nodeKey="test-key"
          datasets={mockDatasets}
          onAddContext={vi.fn()}
        />,
      )
      expect(
        screen.getByText('common.promptEditor.context.modal.add'),
      ).toBeInTheDocument()
    })

    it('should show the footer text when open', () => {
      defaultSetup({ open: true })
      render(
        <ContextBlockComponent
          nodeKey="test-key"
          datasets={mockDatasets}
          onAddContext={vi.fn()}
        />,
      )
      expect(
        screen.getByText('common.promptEditor.context.modal.footer'),
      ).toBeInTheDocument()
    })

    it('should render folder icon for each dataset', () => {
      defaultSetup({ open: true })
      render(
        <ContextBlockComponent
          nodeKey="test-key"
          datasets={mockDatasets}
          onAddContext={vi.fn()}
        />,
      )
      const folders = screen.getAllByTestId('folder-icon')
      expect(folders.length).toBeGreaterThanOrEqual(2)
    })

    it('should not render dropdown content when canNotAddContext is true', () => {
      defaultSetup({ open: true })
      render(
        <ContextBlockComponent
          nodeKey="test-key"
          datasets={mockDatasets}
          onAddContext={vi.fn()}
          canNotAddContext
        />,
      )
      // Modal content should not be present
      expect(screen.queryByText('Dataset A')).not.toBeInTheDocument()
      expect(
        screen.queryByText('common.promptEditor.context.modal.add'),
      ).not.toBeInTheDocument()
    })
  })

  describe('User Interactions', () => {
    it('should call onAddContext when add button is clicked', async () => {
      defaultSetup({ open: true })
      const handleAddContext = vi.fn()
      render(
        <ContextBlockComponent
          nodeKey="test-key"
          datasets={mockDatasets}
          onAddContext={handleAddContext}
        />,
      )

      const addButton = screen.getByTestId('add-button')
      await userEvent.click(addButton)
      expect(handleAddContext).toHaveBeenCalledTimes(1)
    })

    it('should render the count badge with open styles when dropdown is open', () => {
      defaultSetup({ open: true })
      render(
        <ContextBlockComponent
          nodeKey="test-key"
          datasets={mockDatasets}
          onAddContext={vi.fn()}
        />,
      )
      const countBadge = screen.getByText('2')
      expect(countBadge).toHaveClass('bg-[#6938EF]')
      expect(countBadge).toHaveClass('text-white')
    })

    it('should render the count badge with closed styles when dropdown is closed', () => {
      defaultSetup({ open: false })
      render(
        <ContextBlockComponent
          nodeKey="test-key"
          datasets={mockDatasets}
          onAddContext={vi.fn()}
        />,
      )
      const countBadge = screen.getByText('2')
      expect(countBadge).toHaveClass('bg-white/50')
    })
  })

  describe('Event Emitter Subscription', () => {
    it('should subscribe to event emitter on mount', () => {
      defaultSetup()
      render(
        <ContextBlockComponent nodeKey="test-key" onAddContext={vi.fn()} />,
      )
      expect(mockUseSubscription).toHaveBeenCalled()
    })

    it('should update local datasets when UPDATE_DATASETS_EVENT_EMITTER event fires', () => {
      defaultSetup({ open: true })
      // Capture the subscription callback
      let subscriptionCallback: (v: Record<string, unknown>) => void = () => { }
      mockUseSubscription.mockImplementation((cb: (v: Record<string, unknown>) => void) => {
        subscriptionCallback = cb
      })

      const { rerender } = render(
        <ContextBlockComponent
          nodeKey="test-key"
          datasets={[]}
          onAddContext={vi.fn()}
        />,
      )

      // Initially no datasets
      expect(screen.getByText('0')).toBeInTheDocument()

      // Simulate event with new datasets
      act(() => {
        subscriptionCallback({
          type: UPDATE_DATASETS_EVENT_EMITTER,
          payload: [
            { id: '3', name: 'New Dataset', type: 'text' },
          ],
        })
      })

      // Re-render to see state updates
      rerender(
        <ContextBlockComponent
          nodeKey="test-key"
          datasets={[]}
          onAddContext={vi.fn()}
        />,
      )

      expect(screen.getByText('1')).toBeInTheDocument()
      expect(screen.getByText('New Dataset')).toBeInTheDocument()
    })

    it('should not update datasets when event type does not match', () => {
      defaultSetup({ open: true })
      let subscriptionCallback: (v: Record<string, unknown>) => void = () => { }
      mockUseSubscription.mockImplementation((cb: (v: Record<string, unknown>) => void) => {
        subscriptionCallback = cb
      })

      render(
        <ContextBlockComponent
          nodeKey="test-key"
          datasets={mockDatasets}
          onAddContext={vi.fn()}
        />,
      )

      // Fire a different event
      act(() => {
        subscriptionCallback({
          type: 'some-other-event',
          payload: [{ id: '3', name: 'Should Not Appear', type: 'text' }],
        })
      })

      expect(screen.queryByText('Should Not Appear')).not.toBeInTheDocument()
      // Original datasets still there
      expect(screen.getByText('Dataset A')).toBeInTheDocument()
    })
  })

  describe('Edge Cases', () => {
    it('should handle empty datasets array', () => {
      defaultSetup({ open: true })
      render(
        <ContextBlockComponent
          nodeKey="test-key"
          datasets={[]}
          onAddContext={vi.fn()}
        />,
      )
      expect(screen.getByText('0')).toBeInTheDocument()
    })

    it('should default datasets to empty array when undefined', () => {
      defaultSetup()
      render(
        <ContextBlockComponent nodeKey="test-key" onAddContext={vi.fn()} />,
      )
      expect(screen.getByText('0')).toBeInTheDocument()
    })

    it('should handle single dataset', () => {
      defaultSetup({ open: true })
      render(
        <ContextBlockComponent
          nodeKey="test-key"
          datasets={[{ id: '1', name: 'Single', type: 'text' }]}
          onAddContext={vi.fn()}
        />,
      )
      expect(screen.getByText('1')).toBeInTheDocument()
      expect(screen.getByText('Single')).toBeInTheDocument()
    })

    it('should handle dataset with long name by truncating', () => {
      defaultSetup({ open: true })
      const longName = 'A'.repeat(200)
      render(
        <ContextBlockComponent
          nodeKey="test-key"
          datasets={[{ id: '1', name: longName, type: 'text' }]}
          onAddContext={vi.fn()}
        />,
      )
      const nameElement = screen.getByText(longName)
      expect(nameElement).toHaveClass('truncate')
    })
  })
})
