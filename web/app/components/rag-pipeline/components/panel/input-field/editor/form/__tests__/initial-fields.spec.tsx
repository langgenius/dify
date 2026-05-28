import type { ComponentType } from 'react'
import { render, screen } from '@testing-library/react'
import { useConfigurations } from '../hooks'
import InitialFields from '../initial-fields'

type MockForm = {
  store: object
  getFieldValue: (fieldName: string) => unknown
  setFieldValue: (fieldName: string, value: unknown) => void
}

const {
  mockForm,
  mockInputField,
} = vi.hoisted(() => ({
  mockForm: {
    store: {},
    getFieldValue: vi.fn(),
    setFieldValue: vi.fn(),
  } as MockForm,
  mockInputField: vi.fn(({ config }: { config: { variable: string } }) => {
    return function FieldComponent() {
      return <div data-testid="input-field">{config.variable}</div>
    }
  }),
}))

vi.mock('@/app/components/base/form', () => ({
  withForm: ({ render }: {
    render: (props: { form: MockForm }) => React.ReactNode
  }) => ({ form }: { form?: MockForm }) => render({ form: form ?? mockForm }),
}))

vi.mock('@/app/components/base/form/form-scenarios/input-field/field', () => ({
  default: mockInputField,
}))

vi.mock('../hooks', () => ({
  useConfigurations: vi.fn(),
}))

describe('InitialFields', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('should build initial fields with the form accessors and supportFile flag', () => {
    vi.mocked(useConfigurations).mockReturnValue([
      { variable: 'type' },
      { variable: 'label' },
    ] as ReturnType<typeof useConfigurations>)

    const InitialFieldsComp = InitialFields({
      initialData: { variable: 'field_1' },
      supportFile: true,
    }) as unknown as ComponentType
    render(<InitialFieldsComp />)

    expect(useConfigurations).toHaveBeenCalledWith(expect.objectContaining({
      supportFile: true,
      getFieldValue: expect.any(Function),
      setFieldValue: expect.any(Function),
    }))
    expect(screen.getAllByTestId('input-field')).toHaveLength(2)
    expect(screen.getByText('type')).toBeInTheDocument()
    expect(screen.getByText('label')).toBeInTheDocument()
  })

  it('should delegate field accessors to the underlying form instance', () => {
    vi.mocked(useConfigurations).mockReturnValue([] as ReturnType<typeof useConfigurations>)
    mockForm.getFieldValue = vi.fn(() => 'label-value')
    mockForm.setFieldValue = vi.fn()

    const InitialFieldsComp = InitialFields({ supportFile: false }) as unknown as ComponentType
    render(<InitialFieldsComp />)

    const call = vi.mocked(useConfigurations).mock.calls[0]?.[0]
    const value = call?.getFieldValue('label')
    call?.setFieldValue('label', 'next-value')

    expect(value).toBe('label-value')
    expect(mockForm.getFieldValue).toHaveBeenCalledWith('label')
    expect(mockForm.setFieldValue).toHaveBeenCalledWith('label', 'next-value')
  })
})
