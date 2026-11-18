import type { AnnotationList } from '@dify/contracts/api/console/apps/types.gen'
import type { consoleClient } from '@/service/console'
import { act } from 'react'
import { page } from 'vite-plus/test/browser'
import { render } from 'vitest-browser-react'
import { consoleQuery } from '@/service/console'
import { createQueryClientWrapper } from '@/test/console/query-client'
import { createSystemFeaturesFixture } from '@/test/console/system-features'
import { createDeferred } from '@/test/deferred'
import { createAppDetailFixture } from '@/test/fixtures/app'
import { createTestQueryClient } from '@/test/query-client'
import Annotation from '../index'

const { list, batchImport, importStatus } = vi.hoisted(() => ({
  list: vi.fn<typeof consoleClient.apps.byAppId.annotations.get>(),
  batchImport: vi.fn<typeof import('@/service/annotation').annotationBatchImport>(),
  importStatus:
    vi.fn<typeof consoleClient.apps.byAppId.annotations.batchImportStatus.byJobId.get>(),
}))

vi.mock('@/service/annotation', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/service/annotation')>()),
  annotationBatchImport: batchImport,
}))

vi.mock('@/service/console', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/service/console')>()
  const { withConsoleResponses, withConsoleClientResponses } =
    await import('@/test/console/service-responses')
  const responses = {
    'systemFeatures.get': () => createSystemFeaturesFixture(),
    'apps.byAppId.annotations.get': (input: never) => list(input),
    'apps.byAppId.annotations.count.get': () => ({ count: 30 }),
    'apps.byAppId.annotations.export.get': () => ({ data: [] }),
    'apps.byAppId.annotations.batchImportStatus.byJobId.get': (input: never) => importStatus(input),
  }
  return {
    ...actual,
    consoleQuery: withConsoleResponses(actual.consoleQuery, responses),
    consoleClient: withConsoleClientResponses(actual.consoleClient, responses),
  }
})

vi.mock('@/hooks/use-timestamp', () => ({ default: () => ({ formatTime: () => 'Created time' }) }))

function rows(question: string): AnnotationList {
  return {
    data: [{ id: question, question, answer: `Answer for ${question}`, created_at: 1700000000 }],
    total: 30,
    page: 1,
    limit: 10,
    has_more: true,
  }
}

const clients: ReturnType<typeof createTestQueryClient>[] = []

async function resolveResponse(
  deferred: ReturnType<typeof createDeferred<AnnotationList>>,
  response: AnnotationList,
) {
  const previous = Reflect.get(globalThis, 'IS_REACT_ACT_ENVIRONMENT')
  Reflect.set(globalThis, 'IS_REACT_ACT_ENVIRONMENT', true)
  try {
    await act(async () => {
      deferred.resolve(response)
      await deferred.promise
    })
  } finally {
    Reflect.set(globalThis, 'IS_REACT_ACT_ENVIRONMENT', previous)
  }
}

async function setup(appId = 'app-a') {
  const client = createTestQueryClient()
  client.setQueryData(consoleQuery.systemFeatures.get.queryKey(), createSystemFeaturesFixture())
  clients.push(client)
  const QueryProvider = createQueryClientWrapper(client)
  const content = (id: string) => (
    <QueryProvider>
      <Annotation appDetail={createAppDetailFixture({ id, mode: 'completion' })} />
    </QueryProvider>
  )
  const screen = await render(content(appId))
  return { screen, content }
}

beforeEach(() => {
  list.mockReset()
  batchImport.mockReset()
  importStatus.mockReset()
})

it('keeps import submission disabled until the completed job has refreshed active queries', async () => {
  const refresh = createDeferred<AnnotationList>()
  list.mockResolvedValueOnce(rows('Before import')).mockReturnValueOnce(refresh.promise)
  batchImport.mockResolvedValue({ job_id: 'import-job', job_status: 'processing' })
  importStatus.mockResolvedValue({ job_id: 'import-job', job_status: 'completed', error_msg: '' })
  const { screen } = await setup()
  await expect.element(screen.getByRole('button', { name: 'Before import' })).toBeVisible()
  await screen.getByRole('button', { name: 'common.operation.more' }).click()
  await screen.getByRole('menuitem', { name: 'appAnnotation.table.header.bulkImport' }).click()
  const dialog = screen.getByRole('dialog', { name: 'appAnnotation.batchModal.title' })
  const input = dialog.element().querySelector<HTMLInputElement>('input[type="file"]')
  if (!input) throw new Error('CSV file input is missing')
  await page
    .elementLocator(input)
    .upload(new File(['Question,Answer\nQ,A'], 'annotations.csv', { type: 'text/csv' }))
  const run = dialog.getByRole('button', { name: 'appAnnotation.batchModal.run' })
  await run.click()
  await expect.poll(() => list.mock.calls.length).toBe(2)
  await expect.element(run).toBeDisabled()
  await expect.element(dialog).toBeVisible()
  expect(batchImport).toHaveBeenCalledOnce()
  await resolveResponse(refresh, rows('Imported record'))
  await expect.element(screen.getByRole('button', { name: 'Imported record' })).toBeVisible()
  await expect.element(dialog).not.toBeInTheDocument()
  expect(batchImport).toHaveBeenCalledOnce()
})
afterEach(() => {
  for (const client of clients) client.clear()
  clients.length = 0
})

// Exercise the real controls and owner with deferred service responses, not a copy of its logic.
it('keeps the current page when an earlier pagination request finishes last', async () => {
  const secondPage = createDeferred<AnnotationList>()
  list.mockImplementation(({ query }) =>
    query?.page === 2 ? secondPage.promise : Promise.resolve(rows('Current first page')),
  )
  const { screen } = await setup()
  await expect.element(screen.getByRole('button', { name: 'Current first page' })).toBeVisible()
  await screen.getByRole('button', { name: 'common.pagination.next' }).click()
  await expect.poll(() => list.mock.calls.some(([input]) => input.query?.page === 2)).toBe(true)
  await screen.getByRole('button', { name: 'common.pagination.previous' }).click()
  await resolveResponse(secondPage, rows('Stale second page'))
  await expect.element(screen.getByRole('button', { name: 'Current first page' })).toBeVisible()
  await expect
    .element(screen.getByRole('button', { name: 'Stale second page' }))
    .not.toBeInTheDocument()
})

it('keeps the latest search results when a previous keyword finishes last', async () => {
  const earlier = createDeferred<AnnotationList>()
  list.mockImplementation(({ query }) =>
    query?.keyword === 'earlier'
      ? earlier.promise
      : Promise.resolve(rows(query?.keyword === 'latest' ? 'Latest match' : 'Initial match')),
  )
  const { screen } = await setup()
  const search = screen.getByRole('searchbox', { name: 'common.operation.search' })
  await search.fill('earlier')
  await expect
    .poll(() => list.mock.calls.some(([input]) => input.query?.keyword === 'earlier'))
    .toBe(true)
  await search.fill('latest')
  await expect.element(screen.getByRole('button', { name: 'Latest match' })).toBeVisible()
  await resolveResponse(earlier, rows('Stale earlier match'))
  await expect.element(screen.getByRole('button', { name: 'Latest match' })).toBeVisible()
  await expect
    .element(screen.getByRole('button', { name: 'Stale earlier match' }))
    .not.toBeInTheDocument()
})

it('loads the new app without carrying over the previous app page or pending response', async () => {
  const previousApp = createDeferred<AnnotationList>()
  const nextApp = createDeferred<AnnotationList>()
  list.mockImplementation(({ params, query }) =>
    params.app_id === 'app-a' && query?.page === 2
      ? previousApp.promise
      : params.app_id === 'app-b'
        ? nextApp.promise
        : Promise.resolve(rows('App A annotation')),
  )
  const { screen, content } = await setup()
  await expect.element(screen.getByRole('button', { name: 'App A annotation' })).toBeVisible()
  await screen.getByRole('button', { name: 'common.pagination.next' }).click()
  await expect.poll(() => list.mock.calls.some(([input]) => input.query?.page === 2)).toBe(true)
  await screen.rerender(content('app-b'))
  await expect
    .element(screen.getByRole('button', { name: 'App A annotation' }))
    .not.toBeInTheDocument()
  await resolveResponse(nextApp, rows('App B annotation'))
  await expect.element(screen.getByRole('button', { name: 'App B annotation' })).toBeVisible()
  expect(
    list.mock.calls.some(([input]) => input.params.app_id === 'app-b' && input.query?.page === 1),
  ).toBe(true)
  await resolveResponse(previousApp, rows('Old app response'))
  await expect.element(screen.getByRole('button', { name: 'App B annotation' })).toBeVisible()
  await expect
    .element(screen.getByRole('button', { name: 'Old app response' }))
    .not.toBeInTheDocument()
})
