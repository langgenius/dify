import type { DocumentDisplayStatus } from '@/models/datasets'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import StatusItem from './index'

// Mock ToastContext - required to verify notifications
const mockNotify = vi.fn()
vi.mock('use-context-selector', async importOriginal => ({
  ...await importOriginal<typeof import('use-context-selector')>(),
  useContext: () => ({ notify: mockNotify }),
}))

// Mock document service hooks - required to avoid real API calls
const mockEnableDocument = vi.fn()
const mockDisableDocument = vi.fn()
const mockDeleteDocument = vi.fn()

vi.mock('@/service/knowledge/use-document', () => ({
  useDocumentEnable: () => ({ mutateAsync: mockEnableDocument }),
  useDocumentDisable: () => ({ mutateAsync: mockDisableDocument }),
  useDocumentDelete: () => ({ mutateAsync: mockDeleteDocument }),
}))

// Mock useDebounceFn to execute immediately for testing
vi.mock('ahooks', async importOriginal => ({
  ...await importOriginal<typeof import('ahooks')>(),
  useDebounceFn: (fn: (...args: unknown[]) => void) => ({ run: fn }),
}))

// Test utilities
const createQueryClient = () =>
  new QueryClient({
    defaultOptions: {
      queries: { retry: false },
      mutations: { retry: false },
    },
  })

const renderWithProviders = (ui: React.ReactElement) => {
  const queryClient = createQueryClient()
  return render(
    <QueryClientProvider client={queryClient}>
      {ui}
    </QueryClientProvider>,
  )
}

// Factory functions for test data
const createDetailProps = (overrides: Partial<{
  enabled: boolean
  archived: boolean
  id: string
}> = {}) => ({
  enabled: false,
  archived: false,
  id: 'doc-123',
  ...overrides,
})

describe('StatusItem', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockEnableDocument.mockResolvedValue({ result: 'success' })
    mockDisableDocument.mockResolvedValue({ result: 'success' })
    mockDeleteDocument.mockResolvedValue({ result: 'success' })
  })

  // ==================== Rendering Tests ====================
  // Test basic rendering with different status values
  describe('Rendering', () => {
    it('should render without crashing', () => {
      // Arrange & Act
      renderWithProviders(<StatusItem status="available" />)

      // Assert - check indicator element exists (real Indicator component)
      const indicator = screen.getByTestId('status-indicator')
      expect(indicator).toBeInTheDocument()
    })

    it.each([
      ['queuing', 'bg-components-badge-status-light-warning-bg'],
      ['indexing', 'bg-components-badge-status-light-normal-bg'],
      ['paused', 'bg-components-badge-status-light-warning-bg'],
      ['error', 'bg-components-badge-status-light-error-bg'],
      ['available', 'bg-components-badge-status-light-success-bg'],
      ['enabled', 'bg-components-badge-status-light-success-bg'],
      ['disabled', 'bg-components-badge-status-light-disabled-bg'],
      ['archived', 'bg-components-badge-status-light-disabled-bg'],
    ] as const)('should render status "%s" with correct indicator background', (status, expectedBg) => {
      // Arrange & Act
      renderWithProviders(<StatusItem status={status} />)

      // Assert
      const indicator = screen.getByTestId('status-indicator')
      expect(indicator).toHaveClass(expectedBg)
    })

    it('should render status text from translation', () => {
      // Arrange & Act
      renderWithProviders(<StatusItem status="available" />)

      // Assert
      expect(screen.getByText('datasetDocuments.list.status.available')).toBeInTheDocument()
    })

    it('should handle case-insensitive status', () => {
      // Arrange & Act
      renderWithProviders(
        <StatusItem status={'AVAILABLE' as DocumentDisplayStatus} />,
      )

      // Assert
      const indicator = screen.getByTestId('status-indicator')
      expect(indicator).toHaveClass('bg-components-badge-status-light-success-bg')
    })
  })

  // ==================== Props Testing ====================
  // Test all prop variations and combinations
  describe('Props', () => {
    // reverse prop tests
    describe('reverse prop', () => {
      it('should apply default layout when reverse is false', () => {
        // Arrange & Act
        const { container } = renderWithProviders(<StatusItem status="available" reverse={false} />)

        // Assert
        const wrapper = container.firstChild as HTMLElement
        expect(wrapper).not.toHaveClass('flex-row-reverse')
      })

      it('should apply reversed layout when reverse is true', () => {
        // Arrange & Act
        const { container } = renderWithProviders(<StatusItem status="available" reverse />)

        // Assert
        const wrapper = container.firstChild as HTMLElement
        expect(wrapper).toHaveClass('flex-row-reverse')
      })

      it('should apply ml-2 to indicator when reversed', () => {
        // Arrange & Act
        renderWithProviders(<StatusItem status="available" reverse />)

        // Assert
        const indicator = screen.getByTestId('status-indicator')
        expect(indicator).toHaveClass('ml-2')
      })

      it('should apply mr-2 to indicator when not reversed', () => {
        // Arrange & Act
        renderWithProviders(<StatusItem status="available" reverse={false} />)

        // Assert
        const indicator = screen.getByTestId('status-indicator')
        expect(indicator).toHaveClass('mr-2')
      })
    })

    // scene prop tests
    describe('scene prop', () => {
      it('should not render switch in list scene', () => {
        // Arrange & Act
        renderWithProviders(
          <StatusItem
            status="available"
            scene="list"
            detail={createDetailProps()}
          />,
        )

        // Assert - Switch renders as a button element
        expect(screen.queryByRole('switch')).not.toBeInTheDocument()
      })

      it('should render switch in detail scene', () => {
        // Arrange & Act
        renderWithProviders(
          <StatusItem
            status="available"
            scene="detail"
            detail={createDetailProps()}
          />,
        )

        // Assert
        expect(screen.getByRole('switch')).toBeInTheDocument()
      })

      it('should default to list scene', () => {
        // Arrange & Act
        renderWithProviders(
          <StatusItem
            status="available"
            detail={createDetailProps()}
          />,
        )

        // Assert
        expect(screen.queryByRole('switch')).not.toBeInTheDocument()
      })
    })

    // textCls prop tests
    describe('textCls prop', () => {
      it('should apply custom text class', () => {
        // Arrange & Act
        renderWithProviders(
          <StatusItem status="available" textCls="custom-text-class" />,
        )

        // Assert
        const statusText = screen.getByText('datasetDocuments.list.status.available')
        expect(statusText).toHaveClass('custom-text-class')
      })

      it('should default to empty string', () => {
        // Arrange & Act
        renderWithProviders(<StatusItem status="available" />)

        // Assert
        const statusText = screen.getByText('datasetDocuments.list.status.available')
        expect(statusText).toHaveClass('text-sm')
      })
    })

    // errorMessage prop tests
    describe('errorMessage prop', () => {
      it('should render tooltip trigger when errorMessage is provided', () => {
        // Arrange & Act
        renderWithProviders(
          <StatusItem status="error" errorMessage="Something went wrong" />,
        )

        // Assert - tooltip trigger element should exist
        const tooltipTrigger = screen.getByTestId('error-tooltip-trigger')
        expect(tooltipTrigger).toBeInTheDocument()
      })

      it('should show error message on hover', async () => {
        // Arrange
        renderWithProviders(
          <StatusItem status="error" errorMessage="Something went wrong" />,
        )

        // Act - hover the tooltip trigger
        const tooltipTrigger = screen.getByTestId('error-tooltip-trigger')
        fireEvent.mouseEnter(tooltipTrigger)

        // Assert - wait for tooltip content to appear
        expect(await screen.findByText('Something went wrong')).toBeInTheDocument()
      })

      it('should not render tooltip trigger when errorMessage is not provided', () => {
        // Arrange & Act
        renderWithProviders(<StatusItem status="error" />)

        // Assert - tooltip trigger should not exist
        const tooltipTrigger = screen.queryByTestId('error-tooltip-trigger')
        expect(tooltipTrigger).not.toBeInTheDocument()
      })

      it('should not render tooltip trigger when errorMessage is empty', () => {
        // Arrange & Act
        renderWithProviders(<StatusItem status="error" errorMessage="" />)

        // Assert - tooltip trigger should not exist
        const tooltipTrigger = screen.queryByTestId('error-tooltip-trigger')
        expect(tooltipTrigger).not.toBeInTheDocument()
      })
    })

    // detail prop tests
    describe('detail prop', () => {
      it('should use default values when detail is undefined', () => {
        // Arrange & Act
        renderWithProviders(
          <StatusItem status="available" scene="detail" />,
        )

        // Assert - switch should be unchecked (defaultValue = false when archived = false and enabled = false)
        const switchEl = screen.getByRole('switch')
        expect(switchEl).toHaveAttribute('aria-checked', 'false')
      })

      it('should use enabled value from detail', () => {
        // Arrange & Act
        renderWithProviders(
          <StatusItem
            status="available"
            scene="detail"
            detail={createDetailProps({ enabled: true })}
          />,
        )

        // Assert
        const switchEl = screen.getByRole('switch')
        expect(switchEl).toHaveAttribute('aria-checked', 'true')
      })

      it('should set switch to false when archived regardless of enabled', () => {
        // Arrange & Act
        renderWithProviders(
          <StatusItem
            status="available"
            scene="detail"
            detail={createDetailProps({ enabled: true, archived: true })}
          />,
        )

        // Assert - archived overrides enabled, defaultValue becomes false
        const switchEl = screen.getByRole('switch')
        expect(switchEl).toHaveAttribute('aria-checked', 'false')
      })
    })
  })

  // ==================== Memoization Tests ====================
  // Test useMemo logic for embedding status (disables switch)
  describe('Memoization', () => {
    it.each([
      ['queuing', true],
      ['indexing', true],
      ['paused', true],
      ['available', false],
      ['enabled', false],
      ['disabled', false],
      ['archived', false],
      ['error', false],
    ] as const)('should correctly identify embedding status for "%s" - disabled: %s', (status, isEmbedding) => {
      // Arrange & Act
      renderWithProviders(
        <StatusItem
          status={status}
          scene="detail"
          detail={createDetailProps()}
        />,
      )

      // Assert - check if switch is visually disabled (via CSS classes)
      // The Switch component uses CSS classes for disabled state, not the native disabled attribute
      const switchEl = screen.getByRole('switch')
      if (isEmbedding)
        expect(switchEl).toHaveClass('!cursor-not-allowed', '!opacity-50')
      else
        expect(switchEl).not.toHaveClass('!cursor-not-allowed')
    })

    it('should disable switch when archived', () => {
      // Arrange & Act
      renderWithProviders(
        <StatusItem
          status="available"
          scene="detail"
          detail={createDetailProps({ archived: true })}
        />,
      )

      // Assert - visually disabled via CSS classes
      const switchEl = screen.getByRole('switch')
      expect(switchEl).toHaveClass('!cursor-not-allowed', '!opacity-50')
    })

    it('should disable switch when both embedding and archived', () => {
      // Arrange & Act
      renderWithProviders(
        <StatusItem
          status="indexing"
          scene="detail"
          detail={createDetailProps({ archived: true })}
        />,
      )

      // Assert - visually disabled via CSS classes
      const switchEl = screen.getByRole('switch')
      expect(switchEl).toHaveClass('!cursor-not-allowed', '!opacity-50')
    })
  })

  // ==================== Switch Toggle Tests ====================
  // Test Switch toggle interactions
  describe('Switch Toggle', () => {
    it('should call enable operation when switch is toggled on', async () => {
      // Arrange
      const mockOnUpdate = vi.fn()
      renderWithProviders(
        <StatusItem
          status="disabled"
          scene="detail"
          detail={createDetailProps({ enabled: false })}
          datasetId="dataset-123"
          onUpdate={mockOnUpdate}
        />,
      )

      // Act
      const switchEl = screen.getByRole('switch')
      fireEvent.click(switchEl)

      // Assert
      await waitFor(() => {
        expect(mockEnableDocument).toHaveBeenCalledWith({
          datasetId: 'dataset-123',
          documentId: 'doc-123',
        })
      })
    })

    it('should call disable operation when switch is toggled off', async () => {
      // Arrange
      const mockOnUpdate = vi.fn()
      renderWithProviders(
        <StatusItem
          status="enabled"
          scene="detail"
          detail={createDetailProps({ enabled: true })}
          datasetId="dataset-123"
          onUpdate={mockOnUpdate}
        />,
      )

      // Act
      const switchEl = screen.getByRole('switch')
      fireEvent.click(switchEl)

      // Assert
      await waitFor(() => {
        expect(mockDisableDocument).toHaveBeenCalledWith({
          datasetId: 'dataset-123',
          documentId: 'doc-123',
        })
      })
    })

    it('should not call any operation when archived', () => {
      // Arrange
      renderWithProviders(
        <StatusItem
          status="available"
          scene="detail"
          detail={createDetailProps({ archived: true })}
          datasetId="dataset-123"
        />,
      )

      // Act
      const switchEl = screen.getByRole('switch')
      fireEvent.click(switchEl)

      // Assert
      expect(mockEnableDocument).not.toHaveBeenCalled()
      expect(mockDisableDocument).not.toHaveBeenCalled()
    })

    it('should render switch as checked when enabled is true', () => {
      // Arrange & Act
      renderWithProviders(
        <StatusItem
          status="enabled"
          scene="detail"
          detail={createDetailProps({ enabled: true })}
          datasetId="dataset-123"
        />,
      )

      // Assert - verify switch shows checked state
      const switchEl = screen.getByRole('switch')
      expect(switchEl).toHaveAttribute('aria-checked', 'true')
    })

    it('should render switch as unchecked when enabled is false', () => {
      // Arrange & Act
      renderWithProviders(
        <StatusItem
          status="disabled"
          scene="detail"
          detail={createDetailProps({ enabled: false })}
          datasetId="dataset-123"
        />,
      )

      // Assert - verify switch shows unchecked state
      const switchEl = screen.getByRole('switch')
      expect(switchEl).toHaveAttribute('aria-checked', 'false')
    })

    it('should skip enable operation when props.enabled is true (guard branch)', () => {
      // Covers guard condition: if (operationName === 'enable' && enabled) return
      // Note: The guard checks props.enabled, NOT the Switch's internal UI state.
      // This prevents redundant API calls when the UI toggles back to a state
      // that already matches the server-side data (props haven't been updated yet).
      const mockOnUpdate = vi.fn()
      renderWithProviders(
        <StatusItem
          status="enabled"
          scene="detail"
          detail={createDetailProps({ enabled: true })}
          datasetId="dataset-123"
          onUpdate={mockOnUpdate}
        />,
      )

      const switchEl = screen.getByRole('switch')
      // First click: Switch UI toggles OFF, calls disable (props.enabled=true, so allowed)
      fireEvent.click(switchEl)
      // Second click: Switch UI toggles ON, tries to call enable
      // BUT props.enabled is still true (not updated), so guard skips the API call
      fireEvent.click(switchEl)

      // Assert - disable was called once, enable was skipped because props.enabled=true
      expect(mockDisableDocument).toHaveBeenCalledTimes(1)
      expect(mockEnableDocument).not.toHaveBeenCalled()
    })

    it('should skip disable operation when props.enabled is false (guard branch)', () => {
      // Covers guard condition: if (operationName === 'disable' && !enabled) return
      // Note: The guard checks props.enabled, NOT the Switch's internal UI state.
      // This prevents redundant API calls when the UI toggles back to a state
      // that already matches the server-side data (props haven't been updated yet).
      const mockOnUpdate = vi.fn()
      renderWithProviders(
        <StatusItem
          status="disabled"
          scene="detail"
          detail={createDetailProps({ enabled: false })}
          datasetId="dataset-123"
          onUpdate={mockOnUpdate}
        />,
      )

      const switchEl = screen.getByRole('switch')
      // First click: Switch UI toggles ON, calls enable (props.enabled=false, so allowed)
      fireEvent.click(switchEl)
      // Second click: Switch UI toggles OFF, tries to call disable
      // BUT props.enabled is still false (not updated), so guard skips the API call
      fireEvent.click(switchEl)

      // Assert - enable was called once, disable was skipped because props.enabled=false
      expect(mockEnableDocument).toHaveBeenCalledTimes(1)
      expect(mockDisableDocument).not.toHaveBeenCalled()
    })
  })

  // ==================== onUpdate Callback Tests ====================
  // Test onUpdate callback behavior
  describe('onUpdate Callback', () => {
    it('should call onUpdate with operation name on successful enable', async () => {
      // Arrange
      const mockOnUpdate = vi.fn()
      renderWithProviders(
        <StatusItem
          status="disabled"
          scene="detail"
          detail={createDetailProps({ enabled: false })}
          datasetId="dataset-123"
          onUpdate={mockOnUpdate}
        />,
      )

      // Act
      const switchEl = screen.getByRole('switch')
      fireEvent.click(switchEl)

      // Assert
      await waitFor(() => {
        expect(mockOnUpdate).toHaveBeenCalledWith('enable')
      })
    })

    it('should call onUpdate with operation name on successful disable', async () => {
      // Arrange
      const mockOnUpdate = vi.fn()
      renderWithProviders(
        <StatusItem
          status="enabled"
          scene="detail"
          detail={createDetailProps({ enabled: true })}
          datasetId="dataset-123"
          onUpdate={mockOnUpdate}
        />,
      )

      // Act
      const switchEl = screen.getByRole('switch')
      fireEvent.click(switchEl)

      // Assert
      await waitFor(() => {
        expect(mockOnUpdate).toHaveBeenCalledWith('disable')
      })
    })

    it('should not call onUpdate when operation fails', async () => {
      // Arrange
      mockEnableDocument.mockRejectedValue(new Error('API Error'))
      const mockOnUpdate = vi.fn()
      renderWithProviders(
        <StatusItem
          status="disabled"
          scene="detail"
          detail={createDetailProps({ enabled: false })}
          datasetId="dataset-123"
          onUpdate={mockOnUpdate}
        />,
      )

      // Act
      const switchEl = screen.getByRole('switch')
      fireEvent.click(switchEl)

      // Assert
      await waitFor(() => {
        expect(mockNotify).toHaveBeenCalledWith({
          type: 'error',
          message: 'common.actionMsg.modifiedUnsuccessfully',
        })
      })
      expect(mockOnUpdate).not.toHaveBeenCalled()
    })

    it('should not throw when onUpdate is not provided', () => {
      // Arrange
      renderWithProviders(
        <StatusItem
          status="disabled"
          scene="detail"
          detail={createDetailProps({ enabled: false })}
          datasetId="dataset-123"
        />,
      )

      // Act
      const switchEl = screen.getByRole('switch')

      // Assert - should not throw
      expect(() => fireEvent.click(switchEl)).not.toThrow()
    })
  })

  // ==================== API Calls ====================
  // Test API operations and toast notifications
  describe('API Operations', () => {
    it('should show success toast on successful operation', async () => {
      // Arrange
      renderWithProviders(
        <StatusItem
          status="disabled"
          scene="detail"
          detail={createDetailProps({ enabled: false })}
          datasetId="dataset-123"
        />,
      )

      // Act
      const switchEl = screen.getByRole('switch')
      fireEvent.click(switchEl)

      // Assert
      await waitFor(() => {
        expect(mockNotify).toHaveBeenCalledWith({
          type: 'success',
          message: 'common.actionMsg.modifiedSuccessfully',
        })
      })
    })

    it('should show error toast on failed operation', async () => {
      // Arrange
      mockDisableDocument.mockRejectedValue(new Error('Network error'))
      renderWithProviders(
        <StatusItem
          status="enabled"
          scene="detail"
          detail={createDetailProps({ enabled: true })}
          datasetId="dataset-123"
        />,
      )

      // Act
      const switchEl = screen.getByRole('switch')
      fireEvent.click(switchEl)

      // Assert
      await waitFor(() => {
        expect(mockNotify).toHaveBeenCalledWith({
          type: 'error',
          message: 'common.actionMsg.modifiedUnsuccessfully',
        })
      })
    })

    it('should pass correct parameters to enable API', async () => {
      // Arrange
      renderWithProviders(
        <StatusItem
          status="disabled"
          scene="detail"
          detail={createDetailProps({ enabled: false, id: 'test-doc-id' })}
          datasetId="test-dataset-id"
        />,
      )

      // Act
      const switchEl = screen.getByRole('switch')
      fireEvent.click(switchEl)

      // Assert
      await waitFor(() => {
        expect(mockEnableDocument).toHaveBeenCalledWith({
          datasetId: 'test-dataset-id',
          documentId: 'test-doc-id',
        })
      })
    })

    it('should pass correct parameters to disable API', async () => {
      // Arrange
      renderWithProviders(
        <StatusItem
          status="enabled"
          scene="detail"
          detail={createDetailProps({ enabled: true, id: 'test-doc-456' })}
          datasetId="test-dataset-456"
        />,
      )

      // Act
      const switchEl = screen.getByRole('switch')
      fireEvent.click(switchEl)

      // Assert
      await waitFor(() => {
        expect(mockDisableDocument).toHaveBeenCalledWith({
          datasetId: 'test-dataset-456',
          documentId: 'test-doc-456',
        })
      })
    })
  })

  // ==================== Edge Cases ====================
  // Test boundary conditions and unusual inputs
  describe('Edge Cases', () => {
    it('should handle empty datasetId', () => {
      // Arrange & Act
      renderWithProviders(
        <StatusItem
          status="available"
          scene="detail"
          detail={createDetailProps()}
        />,
      )

      // Assert - should render without errors
      expect(screen.getByRole('switch')).toBeInTheDocument()
    })

    it('should handle undefined detail gracefully', () => {
      // Arrange & Act
      renderWithProviders(
        <StatusItem
          status="available"
          scene="detail"
          detail={undefined}
        />,
      )

      // Assert
      const switchEl = screen.getByRole('switch')
      expect(switchEl).toHaveAttribute('aria-checked', 'false')
    })

    it('should handle empty string id in detail', async () => {
      // Arrange
      renderWithProviders(
        <StatusItem
          status="disabled"
          scene="detail"
          detail={createDetailProps({ enabled: false, id: '' })}
          datasetId="dataset-123"
        />,
      )

      // Act
      const switchEl = screen.getByRole('switch')
      fireEvent.click(switchEl)

      // Assert
      await waitFor(() => {
        expect(mockEnableDocument).toHaveBeenCalledWith({
          datasetId: 'dataset-123',
          documentId: '',
        })
      })
    })

    it('should handle very long error messages', async () => {
      // Arrange
      const longErrorMessage = 'A'.repeat(500)
      renderWithProviders(
        <StatusItem status="error" errorMessage={longErrorMessage} />,
      )

      // Act - hover to show tooltip
      const tooltipTrigger = screen.getByTestId('error-tooltip-trigger')
      fireEvent.mouseEnter(tooltipTrigger)

      // Assert
      await waitFor(() => {
        expect(screen.getByText(longErrorMessage)).toBeInTheDocument()
      })
    })

    it('should handle special characters in error message', async () => {
      // Arrange
      const specialChars = '<script>alert("xss")</script> & < > " \''
      renderWithProviders(
        <StatusItem status="error" errorMessage={specialChars} />,
      )

      // Act - hover to show tooltip
      const tooltipTrigger = screen.getByTestId('error-tooltip-trigger')
      fireEvent.mouseEnter(tooltipTrigger)

      // Assert
      await waitFor(() => {
        expect(screen.getByText(specialChars)).toBeInTheDocument()
      })
    })

    it('should handle all status types in sequence', () => {
      // Arrange
      const statuses: DocumentDisplayStatus[] = [
        'queuing',
        'indexing',
        'paused',
        'error',
        'available',
        'enabled',
        'disabled',
        'archived',
      ]

      // Act & Assert
      statuses.forEach((status) => {
        const { unmount } = renderWithProviders(<StatusItem status={status} />)
        const indicator = screen.getByTestId('status-indicator')
        expect(indicator).toBeInTheDocument()
        unmount()
      })
    })
  })

  // ==================== Component Memoization ====================
  // Test React.memo behavior
  describe('Component Memoization', () => {
    it('should be wrapped with React.memo', () => {
      // Assert
      expect(StatusItem).toHaveProperty('$$typeof', Symbol.for('react.memo'))
    })

    it('should render correctly with same props', () => {
      // Arrange
      const props = {
        status: 'available' as const,
        scene: 'detail' as const,
        detail: createDetailProps(),
      }

      // Act
      const { rerender } = renderWithProviders(<StatusItem {...props} />)
      rerender(
        <QueryClientProvider client={createQueryClient()}>
          <StatusItem {...props} />
        </QueryClientProvider>,
      )

      // Assert
      const indicator = screen.getByTestId('status-indicator')
      expect(indicator).toBeInTheDocument()
    })

    it('should update when status prop changes', () => {
      // Arrange
      const { rerender } = renderWithProviders(<StatusItem status="available" />)

      // Assert initial - green/success background
      let indicator = screen.getByTestId('status-indicator')
      expect(indicator).toHaveClass('bg-components-badge-status-light-success-bg')

      // Act
      rerender(
        <QueryClientProvider client={createQueryClient()}>
          <StatusItem status="error" />
        </QueryClientProvider>,
      )

      // Assert updated - red/error background
      indicator = screen.getByTestId('status-indicator')
      expect(indicator).toHaveClass('bg-components-badge-status-light-error-bg')
    })
  })

  // ==================== Styling Tests ====================
  // Test CSS classes and styling
  describe('Styling', () => {
    it('should apply correct status text color for green status', () => {
      // Arrange & Act
      renderWithProviders(<StatusItem status="available" />)

      // Assert
      const statusText = screen.getByText('datasetDocuments.list.status.available')
      expect(statusText).toHaveClass('text-util-colors-green-green-600')
    })

    it('should apply correct status text color for red status', () => {
      // Arrange & Act
      renderWithProviders(<StatusItem status="error" />)

      // Assert
      const statusText = screen.getByText('datasetDocuments.list.status.error')
      expect(statusText).toHaveClass('text-util-colors-red-red-600')
    })

    it('should apply correct status text color for orange status', () => {
      // Arrange & Act
      renderWithProviders(<StatusItem status="queuing" />)

      // Assert
      const statusText = screen.getByText('datasetDocuments.list.status.queuing')
      expect(statusText).toHaveClass('text-util-colors-warning-warning-600')
    })

    it('should apply correct status text color for blue status', () => {
      // Arrange & Act
      renderWithProviders(<StatusItem status="indexing" />)

      // Assert
      const statusText = screen.getByText('datasetDocuments.list.status.indexing')
      expect(statusText).toHaveClass('text-util-colors-blue-light-blue-light-600')
    })

    it('should apply correct status text color for gray status', () => {
      // Arrange & Act
      renderWithProviders(<StatusItem status="disabled" />)

      // Assert
      const statusText = screen.getByText('datasetDocuments.list.status.disabled')
      expect(statusText).toHaveClass('text-text-tertiary')
    })

    it('should render switch with md size in detail scene', () => {
      // Arrange & Act
      renderWithProviders(
        <StatusItem
          status="available"
          scene="detail"
          detail={createDetailProps()}
        />,
      )

      // Assert - check switch has the md size class (h-4 w-7)
      const switchEl = screen.getByRole('switch')
      expect(switchEl).toHaveClass('h-4', 'w-7')
    })
  })
})
