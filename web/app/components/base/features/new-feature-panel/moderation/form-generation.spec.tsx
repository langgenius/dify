import type { I18nText } from '@/i18n-config/language'
import type { CodeBasedExtensionForm } from '@/models/common'
import { fireEvent, render, screen } from '@testing-library/react'
import FormGeneration from './form-generation'

const i18n = (en: string, zh = en): I18nText =>
  ({ 'en-US': en, 'zh-Hans': zh }) as unknown as I18nText

const createForm = (overrides: Partial<CodeBasedExtensionForm> = {}): CodeBasedExtensionForm => ({
  type: 'text-input',
  variable: 'api_key',
  label: i18n('API Key', 'API 密钥'),
  placeholder: 'Enter API key',
  required: true,
  options: [],
  default: '',
  max_length: 100,
  ...overrides,
})

describe('FormGeneration', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('should render text-input form fields', () => {
    const form = createForm()
    render(<FormGeneration forms={[form]} value={{}} onChange={vi.fn()} />)

    expect(screen.getByText('API Key')).toBeInTheDocument()
    expect(screen.getByPlaceholderText('Enter API key')).toBeInTheDocument()
  })

  it('should call onChange when text input value changes', () => {
    const onChange = vi.fn()
    const form = createForm()
    render(<FormGeneration forms={[form]} value={{}} onChange={onChange} />)

    fireEvent.change(screen.getByPlaceholderText('Enter API key'), {
      target: { value: 'my-key' },
    })

    expect(onChange).toHaveBeenCalledWith({ api_key: 'my-key' })
  })

  it('should render paragraph form fields', () => {
    const form = createForm({
      type: 'paragraph',
      variable: 'description',
      label: i18n('Description', '描述'),
      placeholder: 'Enter description',
    })
    render(<FormGeneration forms={[form]} value={{}} onChange={vi.fn()} />)

    expect(screen.getByText('Description')).toBeInTheDocument()
    expect(screen.getByPlaceholderText('Enter description')).toBeInTheDocument()
  })

  it('should render select form fields', () => {
    const form = createForm({
      type: 'select',
      variable: 'model',
      label: i18n('Model', '模型'),
      options: [
        { label: i18n('GPT-4'), value: 'gpt-4' },
        { label: i18n('GPT-3.5'), value: 'gpt-3.5' },
      ],
    })
    render(<FormGeneration forms={[form]} value={{}} onChange={vi.fn()} />)

    expect(screen.getByText('Model')).toBeInTheDocument()
  })

  it('should render multiple forms', () => {
    const forms = [
      createForm({ variable: 'key1', label: i18n('Field 1', '字段1') }),
      createForm({ variable: 'key2', label: i18n('Field 2', '字段2'), type: 'paragraph' }),
    ]
    render(<FormGeneration forms={forms} value={{}} onChange={vi.fn()} />)

    expect(screen.getByText('Field 1')).toBeInTheDocument()
    expect(screen.getByText('Field 2')).toBeInTheDocument()
  })

  it('should display existing values', () => {
    const form = createForm()
    render(
      <FormGeneration
        forms={[form]}
        value={{ api_key: 'existing-key' }}
        onChange={vi.fn()}
      />,
    )

    expect(screen.getByDisplayValue('existing-key')).toBeInTheDocument()
  })

  it('should call onChange when paragraph textarea value changes', () => {
    const onChange = vi.fn()
    const form = createForm({
      type: 'paragraph',
      variable: 'description',
      label: i18n('Description', '描述'),
      placeholder: 'Enter description',
    })
    render(<FormGeneration forms={[form]} value={{}} onChange={onChange} />)

    fireEvent.change(screen.getByPlaceholderText('Enter description'), {
      target: { value: 'my description' },
    })

    expect(onChange).toHaveBeenCalledWith({ description: 'my description' })
  })

  it('should call onChange when select option is chosen', () => {
    const onChange = vi.fn()
    const form = createForm({
      type: 'select',
      variable: 'model',
      label: i18n('Model', '模型'),
      options: [
        { label: i18n('GPT-4'), value: 'gpt-4' },
        { label: i18n('GPT-3.5'), value: 'gpt-3.5' },
      ],
    })
    render(<FormGeneration forms={[form]} value={{}} onChange={onChange} />)

    fireEvent.click(screen.getByText(/placeholder\.select/))
    fireEvent.click(screen.getByText('GPT-4'))

    expect(onChange).toHaveBeenCalledWith({ model: 'gpt-4' })
  })
})
