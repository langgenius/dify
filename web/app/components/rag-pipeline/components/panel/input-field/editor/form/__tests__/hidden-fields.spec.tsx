import type { ComponentType } from 'react'
import { useStore } from '@tanstack/react-form'
import { render, screen } from '@testing-library/react'
import HiddenFields from '../hidden-fields'
import { useHiddenConfigurations } from '../hooks'

type MockForm = {
  store: object
}

const {
  mockForm,
  mockInputField,
} = vi.hoisted(() => ({
  mockForm: {
    store: {},
  } as MockForm,
  mockInputField: vi.fn(({ config }: { config: { variable: string } }) => {
    return function FieldComponent() {
      return <div data-testid="input-field">{config.variable}</div>
    }
  }),
}))

vi.mock('@tanstack/react-form', () => ({
  useStore: vi.fn(),
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
  useHiddenConfigurations: vi.fn(),
}))

describe('HiddenFields', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.mocked(useStore).mockImplementation((_, selector) => selector({
      values: {
        options: ['option-a', 'option-b'],
      },
    }))
  })

  it('should build fields from the hidden configuration list', () => {
    vi.mocked(useHiddenConfigurations).mockReturnValue([
      { variable: 'default' },
      { variable: 'tooltips' },
    ] as ReturnType<typeof useHiddenConfigurations>)

    const HiddenFieldsComp = HiddenFields({ initialData: { variable: 'field_1' } }) as unknown as ComponentType
    render(<HiddenFieldsComp />)

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

    const HiddenFieldsComp = HiddenFields({}) as unknown as ComponentType
    const { container } = render(<HiddenFieldsComp />)

    expect(container).toBeEmptyDOMElement()
  })
})
