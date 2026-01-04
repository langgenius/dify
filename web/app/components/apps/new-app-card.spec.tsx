import { fireEvent, render, screen } from '@testing-library/react'
import * as React from 'react'

// Import after mocks
import CreateAppCard from './new-app-card'

// Mock next/navigation
const mockReplace = vi.fn()
vi.mock('next/navigation', () => ({
  useRouter: () => ({
    replace: mockReplace,
  }),
  useSearchParams: () => new URLSearchParams(),
}))

// Mock provider context
const mockOnPlanInfoChanged = vi.fn()
vi.mock('@/context/provider-context', () => ({
  useProviderContext: () => ({
    onPlanInfoChanged: mockOnPlanInfoChanged,
  }),
}))

// Mock next/dynamic to immediately resolve components
vi.mock('next/dynamic', () => ({
  default: (importFn: () => Promise<any>) => {
    const fnString = importFn.toString()

    if (fnString.includes('create-app-modal') && !fnString.includes('create-from-dsl-modal')) {
      return function MockCreateAppModal({ show, onClose, onSuccess, onCreateFromTemplate }: any) {
        if (!show)
          return null
        return React.createElement('div', { 'data-testid': 'create-app-modal' }, React.createElement('button', { 'onClick': onClose, 'data-testid': 'close-create-modal' }, 'Close'), React.createElement('button', { 'onClick': onSuccess, 'data-testid': 'success-create-modal' }, 'Success'), React.createElement('button', { 'onClick': onCreateFromTemplate, 'data-testid': 'to-template-modal' }, 'To Template'))
      }
    }
    if (fnString.includes('create-app-dialog')) {
      return function MockCreateAppTemplateDialog({ show, onClose, onSuccess, onCreateFromBlank }: any) {
        if (!show)
          return null
        return React.createElement('div', { 'data-testid': 'create-template-dialog' }, React.createElement('button', { 'onClick': onClose, 'data-testid': 'close-template-dialog' }, 'Close'), React.createElement('button', { 'onClick': onSuccess, 'data-testid': 'success-template-dialog' }, 'Success'), React.createElement('button', { 'onClick': onCreateFromBlank, 'data-testid': 'to-blank-modal' }, 'To Blank'))
      }
    }
    if (fnString.includes('create-from-dsl-modal')) {
      return function MockCreateFromDSLModal({ show, onClose, onSuccess }: any) {
        if (!show)
          return null
        return React.createElement('div', { 'data-testid': 'create-dsl-modal' }, React.createElement('button', { 'onClick': onClose, 'data-testid': 'close-dsl-modal' }, 'Close'), React.createElement('button', { 'onClick': onSuccess, 'data-testid': 'success-dsl-modal' }, 'Success'))
      }
    }
    return () => null
  },
}))

// Mock CreateFromDSLModalTab enum
vi.mock('@/app/components/app/create-from-dsl-modal', () => ({
  CreateFromDSLModalTab: {
    FROM_URL: 'from-url',
  },
}))

describe('CreateAppCard', () => {
  const defaultRef = { current: null } as React.RefObject<HTMLDivElement | null>

  beforeEach(() => {
    vi.clearAllMocks()
  })

  describe('Rendering', () => {
    it('should render without crashing', () => {
      render(<CreateAppCard ref={defaultRef} />)
      // Use pattern matching for resilient text assertions
      expect(screen.getByText('app.createApp')).toBeInTheDocument()
    })

    it('should render three create buttons', () => {
      render(<CreateAppCard ref={defaultRef} />)

      expect(screen.getByText('app.newApp.startFromBlank')).toBeInTheDocument()
      expect(screen.getByText('app.newApp.startFromTemplate')).toBeInTheDocument()
      expect(screen.getByText('app.importDSL')).toBeInTheDocument()
    })

    it('should render all buttons as clickable', () => {
      render(<CreateAppCard ref={defaultRef} />)

      const buttons = screen.getAllByRole('button')
      expect(buttons).toHaveLength(3)
      buttons.forEach((button) => {
        expect(button).not.toBeDisabled()
      })
    })
  })

  describe('Props', () => {
    it('should apply custom className', () => {
      const { container } = render(
        <CreateAppCard ref={defaultRef} className="custom-class" />,
      )
      const card = container.firstChild as HTMLElement
      expect(card).toHaveClass('custom-class')
    })

    it('should render with selectedAppType prop', () => {
      render(<CreateAppCard ref={defaultRef} selectedAppType="chat" />)
      expect(screen.getByText('app.createApp')).toBeInTheDocument()
    })
  })

  describe('User Interactions - Create App Modal', () => {
    it('should open create app modal when clicking Start from Blank', () => {
      render(<CreateAppCard ref={defaultRef} />)

      fireEvent.click(screen.getByText('app.newApp.startFromBlank'))

      expect(screen.getByTestId('create-app-modal')).toBeInTheDocument()
    })

    it('should close create app modal when clicking close button', () => {
      render(<CreateAppCard ref={defaultRef} />)

      fireEvent.click(screen.getByText('app.newApp.startFromBlank'))
      expect(screen.getByTestId('create-app-modal')).toBeInTheDocument()

      fireEvent.click(screen.getByTestId('close-create-modal'))
      expect(screen.queryByTestId('create-app-modal')).not.toBeInTheDocument()
    })

    it('should call onSuccess and onPlanInfoChanged on create app success', () => {
      const mockOnSuccess = vi.fn()
      render(<CreateAppCard ref={defaultRef} onSuccess={mockOnSuccess} />)

      fireEvent.click(screen.getByText('app.newApp.startFromBlank'))
      fireEvent.click(screen.getByTestId('success-create-modal'))

      expect(mockOnPlanInfoChanged).toHaveBeenCalled()
      expect(mockOnSuccess).toHaveBeenCalled()
    })

    it('should switch from create modal to template dialog', () => {
      render(<CreateAppCard ref={defaultRef} />)

      fireEvent.click(screen.getByText('app.newApp.startFromBlank'))
      expect(screen.getByTestId('create-app-modal')).toBeInTheDocument()

      fireEvent.click(screen.getByTestId('to-template-modal'))

      expect(screen.queryByTestId('create-app-modal')).not.toBeInTheDocument()
      expect(screen.getByTestId('create-template-dialog')).toBeInTheDocument()
    })
  })

  describe('User Interactions - Template Dialog', () => {
    it('should open template dialog when clicking Start from Template', () => {
      render(<CreateAppCard ref={defaultRef} />)

      fireEvent.click(screen.getByText('app.newApp.startFromTemplate'))

      expect(screen.getByTestId('create-template-dialog')).toBeInTheDocument()
    })

    it('should close template dialog when clicking close button', () => {
      render(<CreateAppCard ref={defaultRef} />)

      fireEvent.click(screen.getByText('app.newApp.startFromTemplate'))
      expect(screen.getByTestId('create-template-dialog')).toBeInTheDocument()

      fireEvent.click(screen.getByTestId('close-template-dialog'))
      expect(screen.queryByTestId('create-template-dialog')).not.toBeInTheDocument()
    })

    it('should call onSuccess and onPlanInfoChanged on template success', () => {
      const mockOnSuccess = vi.fn()
      render(<CreateAppCard ref={defaultRef} onSuccess={mockOnSuccess} />)

      fireEvent.click(screen.getByText('app.newApp.startFromTemplate'))
      fireEvent.click(screen.getByTestId('success-template-dialog'))

      expect(mockOnPlanInfoChanged).toHaveBeenCalled()
      expect(mockOnSuccess).toHaveBeenCalled()
    })

    it('should switch from template dialog to create modal', () => {
      render(<CreateAppCard ref={defaultRef} />)

      fireEvent.click(screen.getByText('app.newApp.startFromTemplate'))
      expect(screen.getByTestId('create-template-dialog')).toBeInTheDocument()

      fireEvent.click(screen.getByTestId('to-blank-modal'))

      expect(screen.queryByTestId('create-template-dialog')).not.toBeInTheDocument()
      expect(screen.getByTestId('create-app-modal')).toBeInTheDocument()
    })
  })

  describe('User Interactions - DSL Import Modal', () => {
    it('should open DSL modal when clicking Import DSL', () => {
      render(<CreateAppCard ref={defaultRef} />)

      fireEvent.click(screen.getByText('app.importDSL'))

      expect(screen.getByTestId('create-dsl-modal')).toBeInTheDocument()
    })

    it('should close DSL modal when clicking close button', () => {
      render(<CreateAppCard ref={defaultRef} />)

      fireEvent.click(screen.getByText('app.importDSL'))
      expect(screen.getByTestId('create-dsl-modal')).toBeInTheDocument()

      fireEvent.click(screen.getByTestId('close-dsl-modal'))
      expect(screen.queryByTestId('create-dsl-modal')).not.toBeInTheDocument()
    })

    it('should call onSuccess and onPlanInfoChanged on DSL import success', () => {
      const mockOnSuccess = vi.fn()
      render(<CreateAppCard ref={defaultRef} onSuccess={mockOnSuccess} />)

      fireEvent.click(screen.getByText('app.importDSL'))
      fireEvent.click(screen.getByTestId('success-dsl-modal'))

      expect(mockOnPlanInfoChanged).toHaveBeenCalled()
      expect(mockOnSuccess).toHaveBeenCalled()
    })
  })

  describe('Styling', () => {
    it('should have correct card container styling', () => {
      const { container } = render(<CreateAppCard ref={defaultRef} />)
      const card = container.firstChild as HTMLElement

      expect(card).toHaveClass('h-[160px]', 'rounded-xl')
    })

    it('should have proper button styling', () => {
      render(<CreateAppCard ref={defaultRef} />)

      const buttons = screen.getAllByRole('button')
      buttons.forEach((button) => {
        expect(button).toHaveClass('cursor-pointer')
      })
    })
  })

  describe('Edge Cases', () => {
    it('should handle multiple modal opens/closes', () => {
      render(<CreateAppCard ref={defaultRef} />)

      // Open and close create modal
      fireEvent.click(screen.getByText('app.newApp.startFromBlank'))
      fireEvent.click(screen.getByTestId('close-create-modal'))

      // Open and close template dialog
      fireEvent.click(screen.getByText('app.newApp.startFromTemplate'))
      fireEvent.click(screen.getByTestId('close-template-dialog'))

      // Open and close DSL modal
      fireEvent.click(screen.getByText('app.importDSL'))
      fireEvent.click(screen.getByTestId('close-dsl-modal'))

      // No modals should be visible
      expect(screen.queryByTestId('create-app-modal')).not.toBeInTheDocument()
      expect(screen.queryByTestId('create-template-dialog')).not.toBeInTheDocument()
      expect(screen.queryByTestId('create-dsl-modal')).not.toBeInTheDocument()
    })

    it('should handle onSuccess not being provided', () => {
      render(<CreateAppCard ref={defaultRef} />)

      fireEvent.click(screen.getByText('app.newApp.startFromBlank'))
      // This should not throw an error
      expect(() => {
        fireEvent.click(screen.getByTestId('success-create-modal'))
      }).not.toThrow()

      expect(mockOnPlanInfoChanged).toHaveBeenCalled()
    })
  })
})
