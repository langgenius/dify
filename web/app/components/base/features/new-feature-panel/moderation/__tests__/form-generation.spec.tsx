import type { I18nText } from '@/i18n/language'
import type { CodeBasedExtensionForm } from '@/models/common'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { useState } from 'react'
import { LanguagesSupported } from '@/i18n/language'
import FormGeneration from '../form-generation'

const locale = vi.hoisted(() => ({ value: 'en-US' }))
vi.mock('#i18n', async (importOriginal) => ({
  ...(await importOriginal<typeof import('#i18n')>()),
  useLocale: () => locale.value,
}))
const label = (en: string, zh = en): I18nText =>
  Object.fromEntries(
    LanguagesSupported.map((language) => [language, language === 'zh-Hans' ? zh : en]),
  ) as I18nText
const field = (overrides: Partial<CodeBasedExtensionForm> = {}): CodeBasedExtensionForm => ({
  type: 'text-input',
  variable: 'api_key',
  label: label('API key', 'API 密钥'),
  placeholder: 'Enter API key',
  required: true,
  options: [],
  default: '',
  max_length: 100,
  ...overrides,
})
const forms = [
  field(),
  field({ type: 'paragraph', variable: 'description', label: label('Description', '描述') }),
  field({
    type: 'select',
    variable: 'model',
    label: label('Model', '模型'),
    placeholder: 'Choose model',
    options: [
      { label: label('GPT-4', '智谱-4'), value: 'gpt-4' },
      { label: label('GPT-3.5', '智谱-3.5'), value: 'gpt-3.5' },
    ],
  }),
]
function Form({ onChange }: { onChange: (patch: Record<string, string>) => void }) {
  const [value, setValue] = useState<Record<string, string>>({ api_key: 'existing-key' })
  return (
    <FormGeneration
      forms={forms}
      value={value}
      onChange={(patch) => {
        onChange(patch)
        setValue((current) => ({ ...current, ...patch }))
      }}
    />
  )
}

beforeEach(() => {
  locale.value = 'en-US'
})

it('emits field-specific patches for text, paragraph, and selection without losing other values', async () => {
  const user = userEvent.setup()
  const onChange = vi.fn()
  render(<Form onChange={onChange} />)
  const key = screen.getByRole('textbox', { name: 'API key' })
  expect(key).toHaveValue('existing-key')
  await user.clear(key)
  await user.type(key, 'updated-key')
  expect(onChange).toHaveBeenLastCalledWith({ api_key: 'updated-key' })
  await user.type(screen.getByRole('textbox', { name: 'Description' }), 'Review requests')
  expect(onChange).toHaveBeenLastCalledWith({ description: 'Review requests' })
  await user.click(screen.getByRole('combobox'))
  await user.click(await screen.findByRole('option', { name: 'GPT-4' }))
  expect(onChange).toHaveBeenLastCalledWith({ model: 'gpt-4' })
  expect(screen.getByRole('combobox')).toHaveTextContent('GPT-4')
  expect(key).toHaveValue('updated-key')
  expect(screen.getByRole('textbox', { name: 'Description' })).toHaveValue('Review requests')
})

it('shows Chinese labels while preserving the option identifier in emitted data', async () => {
  locale.value = 'zh-Hans'
  const user = userEvent.setup()
  const onChange = vi.fn()
  render(<Form onChange={onChange} />)
  expect(screen.getByRole('textbox', { name: 'API 密钥' })).toBeInTheDocument()
  expect(screen.getByText('模型')).toBeInTheDocument()
  await user.click(screen.getByRole('combobox'))
  await user.click(await screen.findByRole('option', { name: '智谱-4' }))
  expect(onChange).toHaveBeenLastCalledWith({ model: 'gpt-4' })
  expect(screen.getByRole('combobox')).toHaveTextContent('智谱-4')
})
