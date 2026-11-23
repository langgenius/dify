import { useState } from 'react'
import { userEvent } from 'vite-plus/test/browser'
import { render } from 'vitest-browser-react'
import { AppToaster } from '@/app/notifications/app-toaster'
import { createConsoleQueryWrapper } from '@/test/console/query-data'
import { hold, installFakeApi } from '@/test/fake-api'
import examples from '../examples'
import GetSchema from '../get-schema'

function SchemaEditor() {
  // GetSchema is a controlled import action: the consumer owns the editable schema.
  const [schema, setSchema] = useState('Original schema')
  return (
    <>
      <GetSchema onChange={setSchema} />
      <label>
        Tool schema
        <textarea value={schema} onChange={(event) => setSchema(event.target.value)} />
      </label>
      <AppToaster />
    </>
  )
}
async function setup() {
  const fake = installFakeApi({
    console: {
      workspaces: {
        current: {
          toolProvider: { api: { remote: { get: async () => ({ schema: 'fetched-schema' }) } } },
        },
      },
    },
  })
  onTestFinished(fake)
  const { wrapper: Providers } = createConsoleQueryWrapper()
  const screen = await render(
    <Providers>
      <SchemaEditor />
    </Providers>,
  )
  return { screen, importSchema: fake.console.workspaces.current.toolProvider.api.remote.get }
}

it('validates the URL, prevents duplicate imports, then replaces the editable schema', async () => {
  const { screen, importSchema } = await setup()
  const pending = hold(importSchema)
  const trigger = screen.getByRole('button', { name: 'tools.createTool.importFromUrl' })
  const schema = screen.getByRole('textbox', { name: 'Tool schema' })
  await trigger.click()
  const popup = screen.getByRole('dialog', { name: 'tools.createTool.importFromUrl' })
  const input = popup.getByRole('textbox', { name: 'tools.createTool.importFromUrl' })
  const submit = popup.getByRole('button', { name: 'common.operation.ok' })
  await expect.element(submit).toBeDisabled()
  await input.fill('ftp://invalid')
  await submit.click()
  const error = screen.getByRole('dialog', { name: 'tools.createTool.urlError' })
  await expect.element(error).toBeVisible()
  await error.hover()
  await error.getByRole('button', { name: 'Close notification' }).click()
  await expect.element(error).not.toBeInTheDocument()
  await expect.element(popup).not.toBeInTheDocument()
  await trigger.click()
  expect(importSchema).not.toHaveBeenCalled()
  await expect.element(schema).toHaveValue('Original schema')

  await input.fill('https://example.com/schema.json')
  await userEvent.keyboard('{Enter}')
  await expect.element(submit).toHaveAttribute('aria-disabled', 'true')
  await userEvent.keyboard('{Enter}')
  await expect
    .poll(() => importSchema)
    .toHaveBeenCalledExactlyOnceWith(
      expect.objectContaining({ query: { url: 'https://example.com/schema.json' } }),
    )
  await expect.element(schema).toHaveValue('Original schema')
  pending.resolve({ schema: 'fetched-schema' })
  await expect.element(popup).not.toBeInTheDocument()
  await expect.element(schema).toHaveValue('fetched-schema')
  await expect.element(trigger).toHaveFocus()
  await trigger.click()
  await expect.element(input).toHaveValue('')
})

it('replaces the editable schema with the selected example', async () => {
  const { screen } = await setup()
  await screen.getByRole('button', { name: 'tools.createTool.examples' }).click()
  await screen
    .getByRole('menuitem', { name: `tools.createTool.exampleOptions.${examples[0].key}` })
    .click()
  await expect
    .element(screen.getByRole('textbox', { name: 'Tool schema' }))
    .toHaveValue(examples[0].content)
  await expect.element(screen.getByRole('menu')).not.toBeInTheDocument()
})
