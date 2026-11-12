import type { I18nText } from '@/i18n/language'
import type { CodeBasedExtensionForm } from '@/models/common'
import { createInstance } from 'i18next'
import { useState } from 'react'
import { I18nextProvider } from 'react-i18next'
import { page, userEvent } from 'vite-plus/test/browser'
import { render } from 'vitest-browser-react'
import { LanguagesSupported } from '@/i18n/language'
import FormGeneration from '../form-generation'

vi.unmock('react-i18next')

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
function Form() {
  const [value, setValue] = useState<Record<string, string>>({ api_key: 'existing-key' })
  return (
    <>
      <FormGeneration
        forms={forms}
        value={value}
        onChange={(patch) => {
          setValue((current) => ({ ...current, ...patch }))
        }}
      />
      <output aria-label="Extension configuration">{JSON.stringify(value)}</output>
    </>
  )
}

async function renderForm(locale = 'en-US') {
  const i18n = createInstance()
  await i18n.init({ lng: locale, resources: {}, interpolation: { escapeValue: false } })
  return render(
    <I18nextProvider i18n={i18n}>
      <Form />
    </I18nextProvider>,
  )
}

it('edits text, paragraph and selection while preserving the other configured fields', async () => {
  await renderForm()
  const key = page.getByRole('textbox', { name: 'API key' })
  await expect.element(key).toHaveValue('existing-key')
  await key.fill('updated-key')
  await page.getByRole('textbox', { name: 'Description' }).fill('Review requests')
  const select = page.getByRole('combobox')
  await select.click()
  await page.getByRole('option', { name: 'GPT-4' }).click()
  await expect.element(select).toHaveTextContent('GPT-4')
  await expect.element(key).toHaveValue('updated-key')
  await expect
    .element(page.getByRole('textbox', { name: 'Description' }))
    .toHaveValue('Review requests')
  await expect
    .element(page.getByRole('status', { name: 'Extension configuration' }))
    .toHaveTextContent(
      JSON.stringify({ api_key: 'updated-key', description: 'Review requests', model: 'gpt-4' }),
    )
})

it('displays Chinese labels and saves the language-independent option identifier', async () => {
  await renderForm('zh-Hans')
  await expect.element(page.getByRole('textbox', { name: 'API 密钥' })).toBeVisible()
  const select = page.getByRole('combobox')
  await select.click()
  await expect.element(page.getByRole('option', { name: '智谱-4' })).toBeVisible()
  await userEvent.keyboard('{ArrowDown}')
  await expect.element(page.getByRole('option', { name: '智谱-4' })).toHaveFocus()
  await userEvent.keyboard('{Enter}')
  await expect.element(select).toHaveTextContent('智谱-4')
  await expect
    .element(page.getByRole('status', { name: 'Extension configuration' }))
    .toHaveTextContent(JSON.stringify({ api_key: 'existing-key', model: 'gpt-4' }))
})
