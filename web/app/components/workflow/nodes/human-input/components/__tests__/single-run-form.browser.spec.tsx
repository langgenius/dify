import { createInstance } from 'i18next'
import { I18nextProvider, initReactI18next } from 'react-i18next'
import { render } from 'vitest-browser-react'
import common from '@/i18n/locales/en-US/common.json'
import workflowHumanInput from '@/i18n/locales/en-US/workflow-human-input.json'
import SingleRunForm from '../single-run-form'

vi.unmock('react-i18next')
const i18n = createInstance().use(initReactI18next)

beforeAll(async () => {
  await i18n.init({
    lng: 'en-US',
    fallbackLng: false,
    keySeparator: false,
    resources: { 'en-US': { common, workflowHumanInput } },
  })
})

it('keeps the full node name inside the form panel', async () => {
  const name = 'Research and development platform engineering operations team'
  const screen = await render(
    <I18nextProvider i18n={i18n}>
      <div style={{ width: 400 }}>
        <SingleRunForm
          nodeName={name}
          showBackButton
          handleBack={() => {}}
          data={{
            form_id: 'form',
            node_id: 'node',
            node_title: name,
            form_content: '',
            inputs: [],
            actions: [],
            form_token: 'token',
            resolved_default_values: {},
            display_in_ui: true,
            expiration_time: 0,
          }}
        />
      </div>
    </I18nextProvider>,
  )
  await expect.element(screen.getByRole('navigation', { name })).toBeVisible()
  await expect.element(screen.getByRole('button', { name: 'Back' })).toBeVisible()
  await expect.element(screen.getByText(name, { exact: true })).toBeVisible()
  const navigation = screen.getByRole('navigation', { name }).element()
  const bounds = navigation.getBoundingClientRect()
  const text = document.createRange()
  text.selectNodeContents(screen.getByText(name, { exact: true }).element())
  const lines = Array.from(text.getClientRects())
  expect(lines.length).toBeGreaterThan(0)
  for (const line of lines) {
    expect(line.right).toBeLessThanOrEqual(bounds.right)
    expect(line.bottom).toBeLessThanOrEqual(bounds.bottom)
  }
  expect(navigation.scrollWidth).toBeLessThanOrEqual(navigation.clientWidth)
})
