import type { AnyFieldApi } from '@tanstack/react-form'
import type { FormSchema } from '@/app/components/base/form/types'
import { useForm } from '@tanstack/react-form'
import { act, fireEvent, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { FormItemValidateStatusEnum, FormTypeEnum } from '@/app/components/base/form/types'
import BaseField from '../base-field'

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
      onSubmit: async () => { },
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

  it('should render text input and propagate changes', async () => {
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

    await act(async () => {
      fireEvent.change(input, { target: { value: 'Updated' } })
    })
    expect(onChange).toHaveBeenCalledWith('title', 'Updated')
    expect(screen.getByText('Title')).toBeInTheDocument()
    expect(screen.getAllByText('*')).toHaveLength(1)
  })

  it('should render only options that satisfy show_on conditions', async () => {
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

    await act(async () => {
      fireEvent.click(screen.getByText('Alpha'))
    })
    expect(screen.queryByText('Beta')).not.toBeInTheDocument()
  })

  it('should not render current select value when it is filtered out by show_on conditions', () => {
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
      defaultValues: { mode: 'beta', enabled: 'no' },
    })

    expect(screen.getByRole('combobox', { name: 'Mode' })).not.toHaveTextContent('beta')
    expect(screen.getByRole('combobox', { name: 'Mode' })).toHaveTextContent('common.placeholder.input')
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

  it('should update value when users click a radio option', async () => {
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

    await act(async () => {
      fireEvent.click(screen.getByText('Private'))
    })
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

  it('should render dynamic options and allow selecting one', async () => {
    const user = userEvent.setup()
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

    await user.click(screen.getByRole('combobox', { name: 'Plugin option' }))
    await user.click(screen.getByRole('option', { name: 'Option A' }))
    expect(screen.getByRole('combobox', { name: 'Plugin option' })).toHaveTextContent('Option A')
  })

  it('should preserve multiple dynamic select values', async () => {
    const user = userEvent.setup()
    mockDynamicOptions.mockReturnValue({
      data: {
        options: [
          { label: { en_US: 'Option A', zh_Hans: '选项A' }, value: 'a' },
          { label: { en_US: 'Option B', zh_Hans: '选项B' }, value: 'b' },
        ],
      },
      isLoading: false,
      error: null,
    })

    renderBaseField({
      formSchema: {
        type: FormTypeEnum.dynamicSelect,
        name: 'plugin_options',
        label: 'Plugin options',
        required: false,
        multiple: true,
      },
      defaultValues: { plugin_options: ['a'] },
      showCurrentValue: true,
    })

    expect(screen.getByRole('combobox', { name: 'Plugin options' })).toHaveTextContent('common.dynamicSelect.selected')

    await user.click(screen.getByRole('combobox', { name: 'Plugin options' }))
    await user.click(screen.getByRole('option', { name: 'Option B' }))

    expect(screen.getByTestId('field-value')).toHaveTextContent('a,b')
  })

  it('should update boolean field when users choose false', async () => {
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
    await act(async () => {
      fireEvent.click(screen.getByText('False'))
    })
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

  it('should render tooltip when provided', async () => {
    renderBaseField({
      formSchema: {
        type: FormTypeEnum.textInput,
        name: 'info',
        label: 'Info',
        required: false,
        tooltip: 'Extra info',
      },
    })

    expect(screen.getByText('Info')).toBeInTheDocument()

    const tooltipTrigger = screen.getByTestId('base-field-tooltip-trigger')
    fireEvent.mouseEnter(tooltipTrigger)

    expect(screen.getByText('Extra info')).toBeInTheDocument()
  })

  it('should render checkbox list and handle changes', async () => {
    renderBaseField({
      formSchema: {
        type: FormTypeEnum.checkbox,
        name: 'features',
        label: 'Features',
        required: false,
        options: [
          { label: 'Feature A', value: 'a' },
          { label: 'Feature B', value: 'b' },
        ],
      },
      defaultValues: { features: ['a'] },
    })

    expect(screen.getByText('Feature A')).toBeInTheDocument()
    expect(screen.getByText('Feature B')).toBeInTheDocument()
    await act(async () => {
      fireEvent.click(screen.getByText('Feature B'))
    })

    const checkboxB = screen.getByTestId('checkbox-b')
    expect(checkboxB).toBeChecked()
  })

  it('should handle dynamic select error state', () => {
    mockDynamicOptions.mockReturnValue({
      data: undefined,
      isLoading: false,
      error: new Error('Failed'),
    })
    renderBaseField({
      formSchema: {
        type: FormTypeEnum.dynamicSelect,
        name: 'ds_error',
        label: 'DS Error',
        required: false,
      },
    })
    expect(screen.getByText('common.placeholder.input')).toBeInTheDocument()
  })

  it('should handle dynamic select no data state', () => {
    mockDynamicOptions.mockReturnValue({
      data: { options: [] },
      isLoading: false,
      error: null,
    })
    renderBaseField({
      formSchema: {
        type: FormTypeEnum.dynamicSelect,
        name: 'ds_empty',
        label: 'DS Empty',
        required: false,
      },
    })
    expect(screen.getByText('common.placeholder.input')).toBeInTheDocument()
  })

  it('should render radio buttons in vertical layout when length >= 3', () => {
    renderBaseField({
      formSchema: {
        type: FormTypeEnum.radio,
        name: 'vertical_radio',
        label: 'Vertical',
        required: false,
        options: [
          { label: 'O1', value: '1' },
          { label: 'O2', value: '2' },
          { label: 'O3', value: '3' },
        ],
      },
    })
    expect(screen.getByText('O1')).toBeInTheDocument()
    expect(screen.getByText('O2')).toBeInTheDocument()
    expect(screen.getByText('O3')).toBeInTheDocument()
  })

  it('should render radio UI when showRadioUI is true', () => {
    renderBaseField({
      formSchema: {
        type: FormTypeEnum.radio,
        name: 'ui_radio',
        label: 'UI Radio',
        required: false,
        showRadioUI: true,
        options: [{ label: 'Option 1', value: '1' }],
      },
    })
    expect(screen.getByText('Option 1')).toBeInTheDocument()
    expect(screen.getByTestId('radio-group')).toBeInTheDocument()
  })

  it('should apply disabled styles', () => {
    renderBaseField({
      formSchema: {
        type: FormTypeEnum.radio,
        name: 'disabled_radio',
        label: 'Disabled',
        required: false,
        options: [{ label: 'Option 1', value: '1' }],
        disabled: true,
      },
    })
    // In radio, the option itself has the disabled class
    expect(screen.getByText('Option 1')).toHaveClass('cursor-not-allowed')
  })

  it('should return empty string for null content in getTranslatedContent', () => {
    renderBaseField({
      formSchema: {
        type: FormTypeEnum.textInput,
        name: 'null_label',
        label: null as unknown as string,
        required: false,
      },
    })
    // Expecting translatedLabel to be '' so title block only renders required * if applicable
    expect(screen.queryByText('*')).not.toBeInTheDocument()
  })
})
