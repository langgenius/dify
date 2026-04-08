import type { InputFieldFormProps } from '../types'
import { render, screen } from '@testing-library/react'
import { useAppForm } from '@/app/components/base/form'
import HiddenFields from '../hidden-fields'
import { useHiddenConfigurations } from '../hooks'

const { mockInputField } = vi.hoisted(() => ({
  mockInputField: vi.fn(({ config }: { config: { variable: string } }) => {
    return function FieldComponent() {
      return <div data-testid="input-field">{config.variable}</div>
    }
  }),
}))

vi.mock('@/app/components/base/form/form-scenarios/input-field/field', () => ({
  default: mockInputField,
}))

vi.mock('../hooks', () => ({
  useHiddenConfigurations: vi.fn(),
}))

describe('HiddenFields', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('should build fields from the hidden configuration list', () => {
    vi.mocked(useHiddenConfigurations).mockReturnValue([
      { variable: 'default' },
      { variable: 'tooltips' },
    ] as ReturnType<typeof useHiddenConfigurations>)

    const HiddenFieldsHarness = () => {
      const initialData: InputFieldFormProps['initialData'] = {
        variable: 'field_1',
        options: ['option-a', 'option-b'],
      }
      const form = useAppForm({
        defaultValues: initialData,
        onSubmit: () => {},
      })
      const HiddenFieldsComp = HiddenFields({ initialData })
      return <HiddenFieldsComp form={form} />
    }
    render(<HiddenFieldsHarness />)

    expect(useHiddenConfigurations).toHaveBeenCalledWith({
      options: ['option-a', 'option-b'],
    })
    expect(mockInputField).toHaveBeenCalledTimes(2)
    expect(screen.getAllByTestId('input-field')).toHaveLength(2)
    expect(screen.getByText('default')).toBeInTheDocument()
    expect(screen.getByText('tooltips')).toBeInTheDocument()
  })

  it('should render nothing when there are no hidden configurations', () => {
    vi.mocked(useHiddenConfigurations).mockReturnValue([])

    const HiddenFieldsHarness = () => {
      const initialData: InputFieldFormProps['initialData'] = { options: [] }
      const form = useAppForm({
        defaultValues: initialData,
        onSubmit: () => {},
      })
      const HiddenFieldsComp = HiddenFields({ initialData })
      return <HiddenFieldsComp form={form} />
    }
    const { container } = render(<HiddenFieldsHarness />)

    expect(container).toBeEmptyDOMElement()
  })
})
