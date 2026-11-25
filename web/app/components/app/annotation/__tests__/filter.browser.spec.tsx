import type { QueryParam } from '../filter'
import { useState } from 'react'
import { userEvent } from 'vite-plus/test/browser'
import { render } from 'vitest-browser-react'
import { createConsoleQueryWrapper } from '@/test/console/query-data'
import { createDeferred } from '@/test/deferred'
import { installFakeApi } from '@/test/fake-api'
import Filter from '../filter'

const appId = '019a0000-0000-7000-8000-000000000001'

// Filter exposes a controlled search value; the fixture supplies only that public prop contract.
function ControlledFilter() {
  const [query, setQuery] = useState<QueryParam>({ keyword: 'initial' })
  return (
    <Filter appId={appId} queryParams={query} setQueryParams={setQuery}>
      <button type="button">Add annotation</button>
    </Filter>
  )
}

async function renderFilter(count: () => { count: number } | Promise<{ count: number }>) {
  onTestFinished(
    installFakeApi({
      console: { apps: { byAppId: { annotations: { count: { get: count } } } } },
    }),
  )
  const { wrapper: ConsoleProvider } = createConsoleQueryWrapper()
  return render(
    <ConsoleProvider>
      <ControlledFilter />
    </ConsoleProvider>,
  )
}

it('withholds filters until the annotation count arrives', async () => {
  const request = createDeferred<{ count: number }>()
  const screen = await renderFilter(() => request.promise)
  await expect.element(screen.getByRole('searchbox')).not.toBeInTheDocument()
  await expect
    .element(screen.getByRole('button', { name: 'Add annotation' }))
    .not.toBeInTheDocument()
  request.resolve({ count: 0 })
  await expect
    .element(screen.getByRole('searchbox', { name: 'common.operation.search' }))
    .toBeVisible()
  await expect.element(screen.getByRole('button', { name: 'Add annotation' })).toBeVisible()
})

it.each([0, 20])(
  'edits and clears the search after count %i loads without losing input focus',
  async (count) => {
    const screen = await renderFilter(() => ({ count }))
    const input = screen.getByRole('searchbox', { name: 'common.operation.search' })
    await expect.element(input).toHaveValue('initial')
    await input.fill('updated')
    await expect.element(input).toHaveValue('updated')
    await screen.getByRole('button', { name: 'common.operation.clear' }).click()
    await expect.element(input).toHaveValue('')
    await expect.element(input).toHaveFocus()
    await expect
      .element(screen.getByRole('button', { name: 'common.operation.clear' }))
      .not.toBeInTheDocument()
    await userEvent.tab()
    await expect.element(screen.getByRole('button', { name: 'Add annotation' })).toHaveFocus()
  },
)
