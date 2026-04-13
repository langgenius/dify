import type { BaseConfiguration } from '@/app/components/base/form/form-scenarios/base/types'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import * as React from 'react'
import { BaseFieldType } from '@/app/components/base/form/form-scenarios/base/types'
import { useConfigurations, useInitialData } from '@/app/components/rag-pipeline/hooks/use-input-fields'
import { useInputVariables } from '../hooks'
import ProcessDocuments from '../index'

// Mock useInputVariables hook
let mockIsFetchingParams = false
let mockParamsConfig: { variables: unknown[] } | undefined = { variables: [] }
vi.mock('../hooks', () => ({
  useInputVariables: vi.fn(() => ({
    isFetchingParams: mockIsFetchingParams,
    paramsConfig: mockParamsConfig,
  })),
}))

// Mock useConfigurations hook
let mockConfigurations: BaseConfiguration[] = []

// Mock useInitialData hook
let mockInitialData: Record<string, unknown> = {}
vi.mock('@/app/components/rag-pipeline/hooks/use-input-fields', () => ({
  useInitialData: vi.fn(() => mockInitialData),
  useConfigurations: vi.fn(() => mockConfigurations),
}))

// Test Data Factory Functions

/**
 * Creates mock configuration for testing
 */
const createMockConfiguration = (overrides: Partial<BaseConfiguration> = {}): BaseConfiguration => ({
  type: BaseFieldType.textInput,
  variable: 'testVariable',
  label: 'Test Label',
  required: false,
  maxLength: undefined,
  options: undefined,
  showConditions: [],
  placeholder: '',
  tooltip: '',
  ...overrides,
})

/**
 * Creates default test props
 */
const createDefaultProps = (overrides: Partial<React.ComponentProps<typeof ProcessDocuments>> = {}) => ({
  dataSourceNodeId: 'test-node-id',
  ref: { current: null } as React.RefObject<unknown>,
  isRunning: false,
  onProcess: vi.fn(),
  onPreview: vi.fn(),
  onSubmit: vi.fn(),
  onBack: vi.fn(),
  ...overrides,
})

describe('ProcessDocuments', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    // Reset mock values
    mockIsFetchingParams = false
    mockParamsConfig = { variables: [] }
    mockInitialData = {}
    mockConfigurations = []
  })

  describe('Rendering', () => {
    // Tests basic rendering functionality
    it('should render without crashing', () => {
      const props = createDefaultProps()

      render(<ProcessDocuments {...props} />)

      // Assert - check for Header title from Form component
      expect(screen.getByText('datasetPipeline.addDocuments.stepTwo.chunkSettings')).toBeInTheDocument()
    })

    it('should render Form and Actions components', () => {
      const props = createDefaultProps()

      render(<ProcessDocuments {...props} />)

      // Assert - check for elements from both components
      expect(screen.getByText('datasetPipeline.addDocuments.stepTwo.chunkSettings')).toBeInTheDocument()
      expect(screen.getByText('datasetPipeline.operations.dataSource')).toBeInTheDocument()
      expect(screen.getByText('datasetPipeline.operations.saveAndProcess')).toBeInTheDocument()
    })

    it('should render with correct container structure', () => {
      const props = createDefaultProps()

      const { container } = render(<ProcessDocuments {...props} />)

      const mainContainer = container.querySelector('.flex.flex-col.gap-y-4.pt-4')
      expect(mainContainer).toBeInTheDocument()
    })
  })

  describe('Props', () => {
    describe('dataSourceNodeId prop', () => {
      it('should pass dataSourceNodeId to useInputVariables hook', () => {
        const props = createDefaultProps({ dataSourceNodeId: 'custom-node-id' })

        render(<ProcessDocuments {...props} />)

        expect(vi.mocked(useInputVariables)).toHaveBeenCalledWith('custom-node-id')
      })

      it('should handle empty dataSourceNodeId', () => {
        const props = createDefaultProps({ dataSourceNodeId: '' })

        render(<ProcessDocuments {...props} />)

        expect(screen.getByText('datasetPipeline.addDocuments.stepTwo.chunkSettings')).toBeInTheDocument()
      })
    })

    describe('isRunning prop', () => {
      it('should disable preview button when isRunning is true', () => {
        const props = createDefaultProps({ isRunning: true })

        render(<ProcessDocuments {...props} />)

        const previewButton = screen.getByRole('button', { name: /datasetPipeline.addDocuments.stepTwo.previewChunks/i })
        expect(previewButton).toBeDisabled()
      })

      it('should not disable preview button when isRunning is false', () => {
        const props = createDefaultProps({ isRunning: false })

        render(<ProcessDocuments {...props} />)

        const previewButton = screen.getByRole('button', { name: /datasetPipeline.addDocuments.stepTwo.previewChunks/i })
        expect(previewButton).not.toBeDisabled()
      })

      it('should disable process button in Actions when isRunning is true', () => {
        mockIsFetchingParams = false
        const props = createDefaultProps({ isRunning: true })

        render(<ProcessDocuments {...props} />)

        const processButton = screen.getByRole('button', { name: /datasetPipeline.operations.saveAndProcess/i })
        expect(processButton).toBeDisabled()
      })
    })

    describe('ref prop', () => {
      it('should expose submit method via ref', () => {
        const mockRef = { current: null } as React.MutableRefObject<{ submit: () => void } | null>
        const props = createDefaultProps({ ref: mockRef })

        render(<ProcessDocuments {...props} />)

        expect(mockRef.current).not.toBeNull()
        expect(typeof mockRef.current?.submit).toBe('function')
      })
    })
  })

  // User Interactions Testing
  describe('User Interactions', () => {
    it('should call onProcess when Actions process button is clicked', () => {
      const onProcess = vi.fn()
      const props = createDefaultProps({ onProcess })

      render(<ProcessDocuments {...props} />)

      fireEvent.click(screen.getByRole('button', { name: /datasetPipeline.operations.saveAndProcess/i }))

      expect(onProcess).toHaveBeenCalledTimes(1)
    })

    it('should call onBack when Actions back button is clicked', () => {
      const onBack = vi.fn()
      const props = createDefaultProps({ onBack })

      render(<ProcessDocuments {...props} />)

      fireEvent.click(screen.getByRole('button', { name: /datasetPipeline.operations.dataSource/i }))

      expect(onBack).toHaveBeenCalledTimes(1)
    })

    it('should call onPreview when preview button is clicked', () => {
      const onPreview = vi.fn()
      const props = createDefaultProps({ onPreview })

      render(<ProcessDocuments {...props} />)

      fireEvent.click(screen.getByRole('button', { name: /datasetPipeline.addDocuments.stepTwo.previewChunks/i }))

      expect(onPreview).toHaveBeenCalledTimes(1)
    })

    it('should call onSubmit when form is submitted', async () => {
      const onSubmit = vi.fn()
      const props = createDefaultProps({ onSubmit })
      const { container } = render(<ProcessDocuments {...props} />)

      const form = container.querySelector('form')!
      fireEvent.submit(form)

      await waitFor(() => {
        expect(onSubmit).toHaveBeenCalled()
      })
    })
  })

  // Hook Integration Tests
  describe('Hook Integration', () => {
    it('should pass variables from useInputVariables to useInitialData', () => {
      const mockVariables = [{ variable: 'testVar', type: 'text', label: 'Test' }]
      mockParamsConfig = { variables: mockVariables }
      const props = createDefaultProps()

      render(<ProcessDocuments {...props} />)

      expect(vi.mocked(useInitialData)).toHaveBeenCalledWith(mockVariables)
    })

    it('should pass variables from useInputVariables to useConfigurations', () => {
      const mockVariables = [{ variable: 'testVar', type: 'text', label: 'Test' }]
      mockParamsConfig = { variables: mockVariables }
      const props = createDefaultProps()

      render(<ProcessDocuments {...props} />)

      expect(vi.mocked(useConfigurations)).toHaveBeenCalledWith(mockVariables)
    })

    it('should use empty array when paramsConfig.variables is undefined', () => {
      mockParamsConfig = { variables: undefined as unknown as unknown[] }
      const props = createDefaultProps()

      render(<ProcessDocuments {...props} />)

      expect(vi.mocked(useInitialData)).toHaveBeenCalledWith([])
      expect(vi.mocked(useConfigurations)).toHaveBeenCalledWith([])
    })

    it('should use empty array when paramsConfig is undefined', () => {
      mockParamsConfig = undefined
      const props = createDefaultProps()

      render(<ProcessDocuments {...props} />)

      expect(vi.mocked(useInitialData)).toHaveBeenCalledWith([])
      expect(vi.mocked(useConfigurations)).toHaveBeenCalledWith([])
    })
  })

  // Actions runDisabled Testing
  describe('Actions runDisabled', () => {
    it('should disable process button when isFetchingParams is true', () => {
      mockIsFetchingParams = true
      const props = createDefaultProps({ isRunning: false })

      render(<ProcessDocuments {...props} />)

      const processButton = screen.getByRole('button', { name: /datasetPipeline.operations.saveAndProcess/i })
      expect(processButton).toBeDisabled()
    })

    it('should disable process button when isRunning is true', () => {
      mockIsFetchingParams = false
      const props = createDefaultProps({ isRunning: true })

      render(<ProcessDocuments {...props} />)

      const processButton = screen.getByRole('button', { name: /datasetPipeline.operations.saveAndProcess/i })
      expect(processButton).toBeDisabled()
    })

    it('should enable process button when both isFetchingParams and isRunning are false', () => {
      mockIsFetchingParams = false
      const props = createDefaultProps({ isRunning: false })

      render(<ProcessDocuments {...props} />)

      const processButton = screen.getByRole('button', { name: /datasetPipeline.operations.saveAndProcess/i })
      expect(processButton).not.toBeDisabled()
    })

    it('should disable process button when both isFetchingParams and isRunning are true', () => {
      mockIsFetchingParams = true
      const props = createDefaultProps({ isRunning: true })

      render(<ProcessDocuments {...props} />)

      const processButton = screen.getByRole('button', { name: /datasetPipeline.operations.saveAndProcess/i })
      expect(processButton).toBeDisabled()
    })
  })

  // Component Memoization Testing
  describe('Component Memoization', () => {
    it('should be wrapped with React.memo', () => {
      // Assert - verify component has memo wrapper
      expect(ProcessDocuments.$$typeof).toBe(Symbol.for('react.memo'))
    })

    it('should render correctly after rerender with same props', () => {
      const props = createDefaultProps()

      const { rerender } = render(<ProcessDocuments {...props} />)
      rerender(<ProcessDocuments {...props} />)

      expect(screen.getByText('datasetPipeline.addDocuments.stepTwo.chunkSettings')).toBeInTheDocument()
    })

    it('should update when dataSourceNodeId prop changes', () => {
      const props = createDefaultProps({ dataSourceNodeId: 'node-1' })

      const { rerender } = render(<ProcessDocuments {...props} />)
      expect(vi.mocked(useInputVariables)).toHaveBeenLastCalledWith('node-1')

      rerender(<ProcessDocuments {...props} dataSourceNodeId="node-2" />)

      expect(vi.mocked(useInputVariables)).toHaveBeenLastCalledWith('node-2')
    })
  })

  // Edge Cases Testing
  describe('Edge Cases', () => {
    it('should handle undefined paramsConfig gracefully', () => {
      mockParamsConfig = undefined
      const props = createDefaultProps()

      render(<ProcessDocuments {...props} />)

      expect(screen.getByText('datasetPipeline.addDocuments.stepTwo.chunkSettings')).toBeInTheDocument()
    })

    it('should handle empty variables array', () => {
      mockParamsConfig = { variables: [] }
      mockConfigurations = []
      const props = createDefaultProps()

      render(<ProcessDocuments {...props} />)

      expect(screen.getByText('datasetPipeline.addDocuments.stepTwo.chunkSettings')).toBeInTheDocument()
    })

    it('should handle special characters in dataSourceNodeId', () => {
      const props = createDefaultProps({ dataSourceNodeId: 'node-id-with-special_chars:123' })

      render(<ProcessDocuments {...props} />)

      expect(vi.mocked(useInputVariables)).toHaveBeenCalledWith('node-id-with-special_chars:123')
    })

    it('should handle long dataSourceNodeId', () => {
      const longId = 'a'.repeat(1000)
      const props = createDefaultProps({ dataSourceNodeId: longId })

      render(<ProcessDocuments {...props} />)

      expect(vi.mocked(useInputVariables)).toHaveBeenCalledWith(longId)
    })

    it('should handle multiple callbacks without interference', () => {
      const onProcess = vi.fn()
      const onBack = vi.fn()
      const onPreview = vi.fn()
      const props = createDefaultProps({ onProcess, onBack, onPreview })

      render(<ProcessDocuments {...props} />)

      fireEvent.click(screen.getByRole('button', { name: /datasetPipeline.operations.saveAndProcess/i }))
      fireEvent.click(screen.getByRole('button', { name: /datasetPipeline.operations.dataSource/i }))
      fireEvent.click(screen.getByRole('button', { name: /datasetPipeline.addDocuments.stepTwo.previewChunks/i }))

      expect(onProcess).toHaveBeenCalledTimes(1)
      expect(onBack).toHaveBeenCalledTimes(1)
      expect(onPreview).toHaveBeenCalledTimes(1)
    })
  })

  // runDisabled Logic Testing (with test.each)
  describe('runDisabled Logic', () => {
    const runDisabledTestCases = [
      { isFetchingParams: false, isRunning: false, expectedDisabled: false },
      { isFetchingParams: false, isRunning: true, expectedDisabled: true },
      { isFetchingParams: true, isRunning: false, expectedDisabled: true },
      { isFetchingParams: true, isRunning: true, expectedDisabled: true },
    ]

    it.each(runDisabledTestCases)(
      'should set process button disabled=$expectedDisabled when isFetchingParams=$isFetchingParams and isRunning=$isRunning',
      ({ isFetchingParams, isRunning, expectedDisabled }) => {
        mockIsFetchingParams = isFetchingParams
        const props = createDefaultProps({ isRunning })

        render(<ProcessDocuments {...props} />)

        const processButton = screen.getByRole('button', { name: /datasetPipeline.operations.saveAndProcess/i })
        if (expectedDisabled)
          expect(processButton).toBeDisabled()
        else
          expect(processButton).not.toBeDisabled()
      },
    )
  })

  // Configuration Rendering Tests
  describe('Configuration Rendering', () => {
    it('should render configurations as form fields', () => {
      mockConfigurations = [
        createMockConfiguration({ variable: 'var1', label: 'Variable 1' }),
        createMockConfiguration({ variable: 'var2', label: 'Variable 2' }),
      ]
      mockInitialData = { var1: '', var2: '' }
      const props = createDefaultProps()

      render(<ProcessDocuments {...props} />)

      expect(screen.getByText('Variable 1')).toBeInTheDocument()
      expect(screen.getByText('Variable 2')).toBeInTheDocument()
    })

    it('should handle configurations with different field types', () => {
      mockConfigurations = [
        createMockConfiguration({ type: BaseFieldType.textInput, variable: 'textVar', label: 'Text Field' }),
        createMockConfiguration({ type: BaseFieldType.numberInput, variable: 'numberVar', label: 'Number Field' }),
      ]
      mockInitialData = { textVar: '', numberVar: 0 }
      const props = createDefaultProps()

      render(<ProcessDocuments {...props} />)

      expect(screen.getByText('Text Field')).toBeInTheDocument()
      expect(screen.getByText('Number Field')).toBeInTheDocument()
    })
  })

  // Full Integration Props Testing
  describe('Full Prop Integration', () => {
    it('should render correctly with all props provided', () => {
      const mockRef = { current: null } as React.MutableRefObject<{ submit: () => void } | null>
      mockIsFetchingParams = false
      mockParamsConfig = { variables: [{ variable: 'testVar', type: 'text', label: 'Test' }] }
      mockInitialData = { testVar: 'initial value' }
      mockConfigurations = [createMockConfiguration({ variable: 'testVar', label: 'Test Variable' })]

      const props = {
        dataSourceNodeId: 'full-test-node',
        ref: mockRef,
        isRunning: false,
        onProcess: vi.fn(),
        onPreview: vi.fn(),
        onSubmit: vi.fn(),
        onBack: vi.fn(),
      }

      render(<ProcessDocuments {...props} />)

      expect(screen.getByText('datasetPipeline.addDocuments.stepTwo.chunkSettings')).toBeInTheDocument()
      expect(screen.getByText('datasetPipeline.operations.dataSource')).toBeInTheDocument()
      expect(screen.getByText('datasetPipeline.operations.saveAndProcess')).toBeInTheDocument()
      expect(screen.getByText('Test Variable')).toBeInTheDocument()
      expect(mockRef.current).not.toBeNull()
    })
  })
})
