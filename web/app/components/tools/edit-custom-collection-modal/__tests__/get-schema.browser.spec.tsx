import type { consoleClient } from '@/service/console'
import { useState } from 'react'
import { userEvent } from 'vite-plus/test/browser'
import { render } from 'vitest-browser-react'
import { AppToaster } from '@/app/notifications/app-toaster'
import { createConsoleQueryWrapper } from '@/test/console/query-data'
import { createDeferred } from '@/test/deferred'
import { guardUnexpectedFetch } from '@/test/unexpected-fetch'
import examples from '../examples'
import GetSchema from '../get-schema'

const importSchema = vi.hoisted(() =>
  vi.fn<typeof consoleClient.workspaces.current.toolProvider.api.remote.get>(),
)
vi.mock('@/service/console', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/service/console')>()
  const { withConsoleClientResponses } = await import('@/test/console/service-responses')
  return {
    ...actual,
    consoleClient: withConsoleClientResponses(actual.consoleClient, {
      'workspaces.current.toolProvider.api.remote.get': importSchema,
    }),
  }
})

beforeEach(() => {
  onTestFinished(guardUnexpectedFetch())
  importSchema.mockReset()
})

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
  const { wrapper: Providers } = createConsoleQueryWrapper()
  return render(
    <Providers>
      <SchemaEditor />
    </Providers>,
  )
}

it('validates the URL, prevents duplicate imports, then replaces the editable schema', async () => {
  const pending = createDeferred<Awaited<ReturnType<typeof importSchema>>>()
  importSchema.mockReturnValue(pending.promise)
  const screen = await setup()
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
  expect(importSchema).toHaveBeenCalledExactlyOnceWith({
    query: { url: 'https://example.com/schema.json' },
  })
  await expect.element(schema).toHaveValue('Original schema')
  pending.resolve({ schema: 'fetched-schema' })
  await expect.element(popup).not.toBeInTheDocument()
  await expect.element(schema).toHaveValue('fetched-schema')
  await expect.element(trigger).toHaveFocus()
  await trigger.click()
  await expect.element(input).toHaveValue('')
})

it('replaces the editable schema with the selected example', async () => {
  const screen = await setup()
  await screen.getByRole('button', { name: 'tools.createTool.examples' }).click()
  await screen
    .getByRole('menuitem', { name: `tools.createTool.exampleOptions.${examples[0].key}` })
    .click()
  await expect
    .element(screen.getByRole('textbox', { name: 'Tool schema' }))
    .toHaveValue(examples[0].content)
  await expect.element(screen.getByRole('menu')).not.toBeInTheDocument()
})
