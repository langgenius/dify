import type { QueryParam } from '../filter'
import type { consoleClient } from '@/service/console'
import { useState } from 'react'
import { userEvent } from 'vite-plus/test/browser'
import { render } from 'vitest-browser-react'
import { createConsoleQueryWrapper } from '@/test/console/query-data'
import { createDeferred } from '@/test/deferred'
import { guardUnexpectedFetch } from '@/test/unexpected-fetch'
import Filter from '../filter'

const countAnnotations = vi.hoisted(() =>
  vi.fn<typeof consoleClient.apps.byAppId.annotations.count.get>(),
)
vi.mock('@/service/console', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/service/console')>()
  const { withConsoleResponses } = await import('@/test/console/service-responses')
  return {
    ...actual,
    consoleQuery: withConsoleResponses(actual.consoleQuery, {
      'apps.byAppId.annotations.count.get': countAnnotations,
    }),
  }
})

// Filter exposes a controlled search value; the fixture supplies only that public prop contract.
function ControlledFilter() {
  const [query, setQuery] = useState<QueryParam>({ keyword: 'initial' })
  return (
    <Filter appId="app-1" queryParams={query} setQueryParams={setQuery}>
      <button type="button">Add annotation</button>
    </Filter>
  )
}

async function renderFilter() {
  const { wrapper: ConsoleProvider } = createConsoleQueryWrapper()
  return render(
    <ConsoleProvider>
      <ControlledFilter />
    </ConsoleProvider>,
  )
}

beforeEach(() => {
  countAnnotations.mockReset()
  onTestFinished(guardUnexpectedFetch())
})

it('withholds filters until the annotation count arrives', async () => {
  const request = createDeferred<{ count: number }>()
  countAnnotations.mockReturnValue(request.promise)
  const screen = await renderFilter()
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
    countAnnotations.mockResolvedValue({ count })
    const screen = await renderFilter()
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
