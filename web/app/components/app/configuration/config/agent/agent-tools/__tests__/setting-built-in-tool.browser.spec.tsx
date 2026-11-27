import { zToolApiEntity } from '@dify/contracts/api/console/workspaces/zod.gen'
import { createInstance } from 'i18next'
import { useState } from 'react'
import { I18nextProvider } from 'react-i18next'
import { page } from 'vite-plus/test/browser'
import { render } from 'vitest-browser-react'
import { selectToolProvider } from '@/app/components/tools/utils/query-select'
import common from '@/i18n/locales/en-US/common.json'
import plugin from '@/i18n/locales/en-US/plugin.json'
import tools from '@/i18n/locales/en-US/tools.json'
import { createConsoleQueryWrapper } from '@/test/console/query-data'
import { createToolProviderFixture } from '@/test/console/tool-provider-fixture'
import { guardUnexpectedFetch } from '@/test/unexpected-fetch'
import SettingBuiltInTool from '../setting-built-in-tool'

vi.unmock('react-i18next')

const tool = zToolApiEntity.parse({
  name: 'search',
  author: 'Team',
  label: { en_US: 'Search tool' },
  description: { en_US: 'Search documents' },
  parameters: [
    {
      name: 'include_images',
      label: { en_US: 'Include images' },
      type: 'boolean',
      form: 'form',
      required: true,
      default: true,
    },
    {
      name: 'ratio',
      label: { en_US: 'Sampling ratio' },
      type: 'number',
      form: 'form',
      default: 1,
      min: 0,
    },
    {
      name: 'depth',
      label: { en_US: 'Search depth' },
      type: 'select',
      form: 'form',
      options: [{ label: { en_US: 'Basic' }, value: 'basic' }],
    },
  ],
})

async function setup({ long = false } = {}) {
  onTestFinished(guardUnexpectedFetch())
  const onSave = vi.fn()
  const onHide = vi.fn()
  const i18n = createInstance()
  await i18n.init({
    lng: 'en-US',
    fallbackLng: 'en-US',
    keySeparator: false,
    interpolation: { escapeValue: false },
    resources: { 'en-US': { common, tools, plugin } },
  })
  const { wrapper: ConsoleWrapper, queryClient } = createConsoleQueryWrapper()
  onTestFinished(() => queryClient.clear())
  const collection = selectToolProvider(
    createToolProviderFixture({
      allow_delete: false,
      plugin_unique_identifier: 'vendor/provider:1.0.0@test',
      tools: [
        {
          ...tool,
          parameters: long
            ? [
                ...tool.parameters!,
                ...Array.from({ length: 20 }, (_, index) => ({
                  ...tool.parameters![0]!,
                  name: `option_${index}`,
                  label: { en_US: `Option ${index}` },
                  required: false,
                })),
              ]
            : tool.parameters,
        },
      ],
    }),
  )
  function Owner() {
    const [open, setOpen] = useState(true)
    return (
      open && (
        <SettingBuiltInTool
          collection={collection}
          toolName="search"
          setting={{}}
          onSave={onSave}
          onHide={() => {
            onHide()
            setOpen(false)
          }}
        />
      )
    )
  }
  await render(
    <ConsoleWrapper>
      <I18nextProvider i18n={i18n}>
        <Owner />
      </I18nextProvider>
    </ConsoleWrapper>,
  )
  return { onSave, onHide }
}

it('preserves boolean defaults, saves false, and leaves an optional select empty', async () => {
  const { onSave } = await setup()
  const images = page.getByRole('switch', { name: 'Include images' })
  await expect.element(images).toBeChecked()
  const depth = page.getByRole('combobox', { name: 'Search depth' })
  await expect.element(depth).toHaveTextContent('Please select')
  await images.click()
  await expect.element(images).not.toBeChecked()
  await page.getByRole('button', { name: 'Save', exact: true }).click()
  expect(onSave).toHaveBeenCalledExactlyOnceWith({ include_images: false, ratio: 1 })
})

it('keeps Save and Cancel visible while scrolling a long settings form and cancels without saving', async () => {
  const { onSave, onHide } = await setup({ long: true })
  const save = page.getByRole('button', { name: 'Save', exact: true })
  const cancel = page.getByRole('button', { name: 'Cancel', exact: true })
  await expect.element(save).toBeVisible()
  const initialTop = save.element().getBoundingClientRect().top
  const last = page.getByRole('switch', { name: 'Option 19', exact: true })
  await last.click()
  await expect.element(last).not.toBeChecked()
  await expect.element(save).toBeVisible()
  expect(save.element().getBoundingClientRect().top).toBeCloseTo(initialTop, 0)
  const dialog = page.getByRole('dialog', { name: 'Search tool' })
  expect(save.element().getBoundingClientRect().bottom).toBeLessThanOrEqual(
    dialog.element().getBoundingClientRect().bottom,
  )
  await cancel.click()
  await expect.element(dialog).not.toBeInTheDocument()
  expect(onHide).toHaveBeenCalledOnce()
  expect(onSave).not.toHaveBeenCalled()
})

it('saves a valid fractional tool setting without imposing an integer step', async () => {
  const { onSave } = await setup()
  await page.getByRole('spinbutton', { name: 'Sampling ratio' }).fill('0.5')
  await page.getByRole('button', { name: 'Save', exact: true }).click()
  expect(onSave).toHaveBeenCalledExactlyOnceWith({ include_images: true, ratio: '0.5' })
})
