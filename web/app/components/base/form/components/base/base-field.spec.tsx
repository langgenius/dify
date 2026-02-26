import type { AnyFieldApi } from '@tanstack/react-form'
import type { FormSchema } from '@/app/components/base/form/types'
import { useForm } from '@tanstack/react-form'
import { fireEvent, render, screen } from '@testing-library/react'
import { FormItemValidateStatusEnum, FormTypeEnum } from '@/app/components/base/form/types'
import BaseField from './base-field'

const mockDynamicOptions = vi.fn()

vi.mock('@/hooks/use-i18n', () => ({
  useRenderI18nObject: () => (content: Record<string, string>) => content.en_US ?? Object.values(content)[0] ?? '',
}))

vi.mock('@/service/use-triggers', () => ({
  useTriggerPluginDynamicOptions: (...args: unknown[]) => mockDynamicOptions(...args),
}))

const renderBaseField = ({
  formSchema,
  defaultValues,
  fieldState,
  onChange,
  showCurrentValue = false,
}: {
  formSchema: FormSchema
  defaultValues?: Record<string, unknown>
  fieldState?: {
    validateStatus?: FormItemValidateStatusEnum
    errors?: string[]
    warnings?: string[]
  }
  onChange?: (field: string, value: unknown) => void
  showCurrentValue?: boolean
}) => {
  const TestComponent = () => {
    const form = useForm({
      defaultValues: defaultValues ?? { [formSchema.name]: '' },
      onSubmit: async () => {},
    })

    return (
      <>
        <form.Field name={formSchema.name}>
          {field => (
            <BaseField
              field={field as unknown as AnyFieldApi}
              formSchema={formSchema}
              fieldState={fieldState}
              onChange={onChange}
            />
          )}
        </form.Field>
        {showCurrentValue && (
          <form.Subscribe selector={state => state.values[formSchema.name]}>
            {value => <div data-testid="field-value">{String(value)}</div>}
          </form.Subscribe>
        )}
      </>
    )
  }

  return render(<TestComponent />)
}

describe('BaseField', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockDynamicOptions.mockReturnValue({
      data: undefined,
      isLoading: false,
      error: null,
    })
  })

  it('should render text input and propagate changes', () => {
    const onChange = vi.fn()
    renderBaseField({
      formSchema: {
        type: FormTypeEnum.textInput,
        name: 'title',
        label: 'Title',
        required: true,
      },
      defaultValues: { title: 'Hello' },
      onChange,
    })

    const input = screen.getByDisplayValue('Hello')
    expect(input).toHaveValue('Hello')

    fireEvent.change(input, { target: { value: 'Updated' } })
    expect(onChange).toHaveBeenCalledWith('title', 'Updated')
    expect(screen.getByText('Title')).toBeInTheDocument()
    expect(screen.getAllByText('*')).toHaveLength(1)
  })

  it('should render only options that satisfy show_on conditions', () => {
    renderBaseField({
      formSchema: {
        type: FormTypeEnum.select,
        name: 'mode',
        label: 'Mode',
        required: false,
        options: [
          { label: 'Alpha', value: 'alpha' },
          { label: 'Beta', value: 'beta', show_on: [{ variable: 'enabled', value: 'yes' }] },
        ],
      },
      defaultValues: { mode: 'alpha', enabled: 'no' },
    })

    fireEvent.click(screen.getByText('Alpha'))
    expect(screen.queryByText('Beta')).not.toBeInTheDocument()
  })

  it('should render dynamic select loading state', () => {
    mockDynamicOptions.mockReturnValue({
      data: undefined,
      isLoading: true,
      error: null,
    })

    renderBaseField({
      formSchema: {
        type: FormTypeEnum.dynamicSelect,
        name: 'plugin',
        label: 'Plugin',
        required: false,
      },
      defaultValues: { plugin: '' },
    })

    expect(screen.getByText('common.dynamicSelect.loading')).toBeInTheDocument()
  })

  it('should update value when users click a radio option', () => {
    const onChange = vi.fn()
    renderBaseField({
      formSchema: {
        type: FormTypeEnum.radio,
        name: 'visibility',
        label: 'Visibility',
        required: false,
        options: [
          { label: 'Public', value: 'public' },
          { label: 'Private', value: 'private' },
        ],
      },
      defaultValues: { visibility: 'public' },
      onChange,
    })

    fireEvent.click(screen.getByText('Private'))
    expect(onChange).toHaveBeenCalledWith('visibility', 'private')
  })

  it('should show validation message when field state has an error', () => {
    renderBaseField({
      formSchema: {
        type: FormTypeEnum.textInput,
        name: 'name',
        label: 'Name',
        required: false,
      },
      fieldState: {
        validateStatus: FormItemValidateStatusEnum.Error,
        errors: ['Name is required'],
      },
    })

    expect(screen.getByText('Name is required')).toBeInTheDocument()
  })

  it('should render description and help link when provided', () => {
    renderBaseField({
      formSchema: {
        type: FormTypeEnum.textInput,
        name: 'doc',
        label: 'Documentation',
        required: false,
        description: 'Read the description',
        url: 'https://example.com/help',
        help: 'Open help docs',
      },
      defaultValues: { doc: '' },
    })

    expect(screen.getByText('Read the description')).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Open help docs' })).toHaveAttribute('href', 'https://example.com/help')
  })

  it('should render secret input with password type', () => {
    renderBaseField({
      formSchema: {
        type: FormTypeEnum.secretInput,
        name: 'token',
        label: 'Token',
        required: false,
      },
      defaultValues: { token: 'abc' },
    })

    expect(screen.getByDisplayValue('abc')).toHaveAttribute('type', 'password')
  })

  it('should render number input with number type', () => {
    renderBaseField({
      formSchema: {
        type: FormTypeEnum.textNumber,
        name: 'count',
        label: 'Count',
        required: false,
      },
      defaultValues: { count: 7 },
    })

    expect(screen.getByDisplayValue('7')).toHaveAttribute('type', 'number')
  })

  it('should render translated object label content', () => {
    renderBaseField({
      formSchema: {
        type: FormTypeEnum.textInput,
        name: 'title_i18n',
        label: { en_US: 'Localized title', zh_Hans: '标题' },
        required: false,
      },
      defaultValues: { title_i18n: '' },
    })

    expect(screen.getByText('Localized title')).toBeInTheDocument()
  })

  it('should render dynamic options and allow selecting one', () => {
    mockDynamicOptions.mockReturnValue({
      data: {
        options: [
          { label: { en_US: 'Option A', zh_Hans: '选项A' }, value: 'a' },
        ],
      },
      isLoading: false,
      error: null,
    })

    renderBaseField({
      formSchema: {
        type: FormTypeEnum.dynamicSelect,
        name: 'plugin_option',
        label: 'Plugin option',
        required: false,
      },
      defaultValues: { plugin_option: '' },
    })

    fireEvent.click(screen.getByText('common.placeholder.input'))
    fireEvent.click(screen.getByText('Option A'))
    expect(screen.getByText('Option A')).toBeInTheDocument()
  })

  it('should update boolean field when users choose false', () => {
    renderBaseField({
      formSchema: {
        type: FormTypeEnum.boolean,
        name: 'enabled',
        label: 'Enabled',
        required: false,
      },
      defaultValues: { enabled: true },
      showCurrentValue: true,
    })

    expect(screen.getByTestId('field-value')).toHaveTextContent('true')
    fireEvent.click(screen.getByText('False'))
    expect(screen.getByTestId('field-value')).toHaveTextContent('false')
  })

  it('should render warning message when field state has a warning', () => {
    renderBaseField({
      formSchema: {
        type: FormTypeEnum.textInput,
        name: 'warning_field',
        label: 'Warning field',
        required: false,
      },
      fieldState: {
        validateStatus: FormItemValidateStatusEnum.Warning,
        warnings: ['This is a warning'],
      },
    })

    expect(screen.getByText('This is a warning')).toBeInTheDocument()
  })
})
