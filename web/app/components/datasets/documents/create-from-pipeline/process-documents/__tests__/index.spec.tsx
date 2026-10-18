import type { BaseConfiguration } from '@/app/components/base/form/form-scenarios/base/types'
import { act, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import * as React from 'react'
import { BaseFieldType } from '@/app/components/base/form/form-scenarios/base/types'
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
const createMockConfiguration = (
  overrides: Partial<BaseConfiguration> = {},
): BaseConfiguration => ({
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
const createDefaultProps = (
  overrides: Partial<React.ComponentProps<typeof ProcessDocuments>> = {},
) => ({
  dataSourceNodeId: 'test-node-id',
  ref: React.createRef<{ submit: () => void }>(),
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

  // User Interactions Testing
  describe('User Interactions', () => {
    it('should call onProcess when Actions process button is clicked', async () => {
      const user = userEvent.setup()
      const onProcess = vi.fn()
      const props = createDefaultProps({ onProcess })

      render(<ProcessDocuments {...props} />)

      await user.click(
        screen.getByRole('button', { name: /datasetPipeline.operations.saveAndProcess/i }),
      )

      expect(onProcess).toHaveBeenCalledTimes(1)
    })

    it('should call onBack when Actions back button is clicked', async () => {
      const user = userEvent.setup()
      const onBack = vi.fn()
      const props = createDefaultProps({ onBack })

      render(<ProcessDocuments {...props} />)

      await user.click(
        screen.getByRole('button', { name: /datasetPipeline.operations.dataSource/i }),
      )

      expect(onBack).toHaveBeenCalledTimes(1)
    })

    it('should call onPreview when preview button is clicked', async () => {
      const user = userEvent.setup()
      const onPreview = vi.fn()
      const props = createDefaultProps({ onPreview })

      render(<ProcessDocuments {...props} />)

      await user.click(
        screen.getByRole('button', {
          name: /datasetPipeline.addDocuments.stepTwo.previewChunks/i,
        }),
      )

      expect(onPreview).toHaveBeenCalledTimes(1)
    })
  })

  // Hook Integration Tests

  // Actions runDisabled Testing

  // Component Memoization Testing

  // Edge Cases Testing

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

        const processButton = screen.getByRole('button', {
          name: /datasetPipeline.operations.saveAndProcess/i,
        })
        if (expectedDisabled) expect(processButton).toBeDisabled()
        else expect(processButton).not.toBeDisabled()
      },
    )
  })

  // Configuration Rendering Tests

  // Full Integration Props Testing
  it('submits the edited processing fields through the public form ref', async () => {
    const user = userEvent.setup()
    mockConfigurations = [createMockConfiguration({ variable: 'separator', label: 'Separator' })]
    mockInitialData = { separator: '---' }
    const ref = React.createRef<{ submit: () => void }>()
    const onSubmit = vi.fn()
    render(<ProcessDocuments {...createDefaultProps({ ref, onSubmit })} />)
    const input = screen.getByDisplayValue('---')
    await user.clear(input)
    await user.type(input, '|||')
    await act(async () => ref.current!.submit())
    await waitFor(() => expect(onSubmit).toHaveBeenCalledWith({ separator: '|||' }))
  })
})
