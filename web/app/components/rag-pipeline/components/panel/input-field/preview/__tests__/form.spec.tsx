import type { RAGPipelineVariables } from '@/models/pipeline'
import { render, screen } from '@testing-library/react'
import Form from '../form'

type MockForm = {
  id: string
}

const {
  mockForm,
  mockBaseField,
  mockUseInitialData,
  mockUseConfigurations,
} = vi.hoisted(() => ({
  mockForm: {
    id: 'form-1',
  } as MockForm,
  mockBaseField: vi.fn(({ config }: { config: { variable: string } }) => {
    return function FieldComponent() {
      return <div data-testid="base-field">{config.variable}</div>
    }
  }),
  mockUseInitialData: vi.fn(() => ({ source: 'node-1' })),
  mockUseConfigurations: vi.fn(() => [{ variable: 'source' }, { variable: 'chunkSize' }]),
}))

vi.mock('@/app/components/base/form', () => ({
  useAppForm: () => mockForm,
}))

vi.mock('@/app/components/base/form/form-scenarios/base/field', () => ({
  default: mockBaseField,
}))

vi.mock('@/app/components/rag-pipeline/hooks/use-input-fields', () => ({
  useInitialData: mockUseInitialData,
  useConfigurations: mockUseConfigurations,
}))

describe('Preview form', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('should build fields from the pipeline variable configuration', () => {
    render(<Form variables={[{ variable: 'source' }] as unknown as RAGPipelineVariables} />)

    expect(mockUseInitialData).toHaveBeenCalled()
    expect(mockUseConfigurations).toHaveBeenCalled()
    expect(screen.getAllByTestId('base-field')).toHaveLength(2)
    expect(screen.getByText('source')).toBeInTheDocument()
    expect(screen.getByText('chunkSize')).toBeInTheDocument()
  })

  it('should prevent the native form submission', () => {
    const { container } = render(<Form variables={[] as unknown as RAGPipelineVariables} />)
    const form = container.querySelector('form')!
    const submitEvent = new Event('submit', { bubbles: true, cancelable: true })

    form.dispatchEvent(submitEvent)

    expect(submitEvent.defaultPrevented).toBe(true)
  })
})
