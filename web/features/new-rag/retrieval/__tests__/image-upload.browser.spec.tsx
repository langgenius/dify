import type { ConsoleClientContext } from '@/service/console'
import { page, userEvent } from 'vite-plus/test/browser'
import { render } from 'vitest-browser-react'
import { createConsoleQueryWrapper } from '@/test/console/query-data'
import { createDeferred } from '@/test/deferred'
import { createKnowledgeSpaceFixture, KnowledgeSpaceTestProvider } from '@/test/knowledge-space'
import { QueryTestingAdapter } from '@/test/query-state-testing-adapter'
import { guardUnexpectedFetch } from '@/test/unexpected-fetch'
import { RetrievalTestPage } from '../page'

const api = vi.hoisted(() => ({ upload: vi.fn() }))
vi.mock('react-i18next', async (importOriginal) => {
  const actual = await importOriginal<typeof import('react-i18next')>()
  const { createReactI18nextMock } = await import('@/test/i18n-mock')
  const { default: retrieval } = await import('@/i18n/locales/en-US/knowledge-retrieval.json')
  const { default: space } = await import('@/i18n/locales/en-US/knowledge-space.json')
  const { default: common } = await import('@/i18n/locales/en-US/common.json')
  const { default: custom } = await import('@/i18n/locales/en-US/custom.json')
  return {
    ...actual,
    ...createReactI18nextMock(
      Object.fromEntries(
        Object.entries({
          knowledgeRetrieval: retrieval,
          knowledgeSpace: space,
          common,
          custom,
        }).flatMap(([namespace, entries]) =>
          Object.entries(entries).map(([key, value]) => [`${namespace}.${key}`, value]),
        ),
      ),
    ),
  }
})
vi.mock('@/next/navigation', () => ({
  useSearchParams: () => new URLSearchParams(),
  usePathname: () => '/datasets/new/space-1/retrieval',
  useRouter: () => ({ push: vi.fn() }),
}))
vi.mock('@/service/console', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/service/console')>()
  const { withConsoleClientResponses, withConsoleResponses } =
    await import('@/test/console/service-responses')
  const space = 'knowledgeFs.spaces.byControlSpaceId'
  const empty = () => ({ data: [], next_cursor: null })
  return {
    ...actual,
    consoleClient: withConsoleClientResponses(actual.consoleClient, {
      'files.upload.post': api.upload,
    }),
    consoleQuery: withConsoleResponses(actual.consoleQuery, {
      [`${space}.traces.get`]: empty,
      [`${space}.researchTasks.get`]: empty,
      [`${space}.settings.get`]: () => ({
        configuration_state: 'active',
        active_profile_available: true,
        active_profile_revisions: { embedding: 1, retrieval: 1 },
        capabilities: {
          deep: true,
          query: true,
          research: true,
          index: true,
          ingest: true,
          source_sync: true,
        },
        embedding: null,
        retrieval: null,
        issues: [],
        revision: 1,
      }),
    }),
  }
})

const imageFile = (name: string) => {
  const canvas = document.createElement('canvas')
  canvas.width = 64
  canvas.height = 64
  const context = canvas.getContext('2d')!
  context.fillStyle = '#2563eb'
  context.fillRect(0, 0, 64, 64)
  const bytes = Uint8Array.from(atob(canvas.toDataURL('image/png').split(',')[1]!), (char) =>
    char.charCodeAt(0),
  )
  return new File([bytes], name, { type: 'image/png' })
}
const uploads: Array<
  ReturnType<typeof createDeferred<{ id: string }>> & {
    file: File
    signal: AbortSignal
    context: ConsoleClientContext
  }
> = []

let network: ReturnType<typeof guardUnexpectedFetch>
beforeEach(() => {
  network = guardUnexpectedFetch()
  uploads.length = 0
  api.upload
    .mockReset()
    .mockImplementation(
      (
        input: { body: { file: File } },
        options: { signal: AbortSignal; context: ConsoleClientContext },
      ) => {
        const deferred = createDeferred<{ id: string }>()
        uploads.push({ ...deferred, file: input.body.file, ...options })
        return deferred.promise
      },
    )
})
afterEach(() => {
  network()
  vi.restoreAllMocks()
})

async function renderPage() {
  const { wrapper: QueryWrapper } = createConsoleQueryWrapper()
  return render(
    <QueryWrapper>
      <QueryTestingAdapter>
        <KnowledgeSpaceTestProvider
          space={createKnowledgeSpaceFixture({
            permission_keys: ['knowledge_space_edit', 'knowledge_space_query'],
          })}
        >
          <div className="h-160 w-full">
            <RetrievalTestPage knowledgeSpaceId="space-1" />
          </div>
        </KnowledgeSpaceTestProvider>
      </QueryTestingAdapter>
    </QueryWrapper>,
  )
}
const input = () => page.getByLabelText('Add images')
const run = () => page.getByRole('button', { name: 'Run' })

it('shows the selected image and byte progress immediately, and waits for the server before enabling retrieval', async () => {
  await page.viewport(1280, 800)
  await renderPage()
  await userEvent.upload(input(), imageFile('diagram.png'))
  const thumbnail = page.getByRole('img', { name: 'diagram.png' })
  await expect.element(thumbnail).toBeVisible()
  await expect.poll(() => (thumbnail.element() as HTMLImageElement).naturalWidth).toBe(64)
  const progress = page.getByRole('progressbar', { name: 'Uploading diagram.png' })
  await expect.element(progress).toHaveAttribute('aria-valuenow', '0')
  uploads[0]!.context.onUploadProgress?.(45)
  await expect.element(progress).toHaveAttribute('aria-valuenow', '45')
  await expect.element(run()).toBeDisabled()
  uploads[0]!.context.onUploadProgress?.(100)
  await expect.element(progress).toBeVisible()
  await expect.element(run()).toBeDisabled()
  uploads[0]!.resolve({ id: 'uploaded-image' })
  await expect.element(progress).not.toBeInTheDocument()
  await expect.element(thumbnail).toBeVisible()
  await expect.element(run()).toBeEnabled()
})

it('keeps successful images while offering retry for only the failed upload', async () => {
  await page.viewport(600, 720)
  await renderPage()
  await userEvent.upload(input(), [imageFile('success.png'), imageFile('retry.png')])
  expect(uploads).toHaveLength(2)
  uploads[0]!.resolve({ id: 'success-image' })
  uploads[1]!.reject(new Error('network unavailable'))
  const retry = page.getByRole('button', { name: 'Retry retry.png' })
  await expect.element(retry).toBeVisible()
  await expect.element(page.getByRole('alert')).toHaveTextContent('Image upload failed. Try again.')
  await expect.element(page.getByRole('img', { name: 'success.png' })).toBeVisible()
  await expect.element(run()).toBeDisabled()
  await retry.click()
  expect(uploads).toHaveLength(3)
  expect(uploads[2]!.file.name).toBe('retry.png')
  uploads[2]!.context.onUploadProgress?.(60)
  await expect.element(page.getByRole('progressbar')).toHaveAttribute('aria-valuenow', '60')
  uploads[2]!.resolve({ id: 'retried-image' })
  await expect.element(page.getByRole('progressbar')).not.toBeInTheDocument()
  await expect.element(page.getByRole('alert')).not.toBeInTheDocument()
  await expect.element(run()).toBeEnabled()
})

it('cancels removed uploads, ignores late responses and releases previews on removal and unmount', async () => {
  const revoke = vi.spyOn(URL, 'revokeObjectURL')
  const view = await renderPage()
  await userEvent.upload(input(), imageFile('removed.png'))
  const thumbnail = page.getByRole('img', { name: 'removed.png' })
  const preview = thumbnail.element().getAttribute('src')
  await page.getByRole('button', { name: 'Remove removed.png' }).click()
  await expect.poll(() => uploads[0]!.signal.aborted).toBe(true)
  await expect.element(thumbnail).not.toBeInTheDocument()
  expect(revoke).toHaveBeenCalledWith(preview)
  uploads[0]!.resolve({ id: 'removed-image' })
  await expect.element(run()).toBeDisabled()
  await userEvent.upload(input(), imageFile('unfinished.png'))
  const unfinishedPreview = page
    .getByRole('img', { name: 'unfinished.png' })
    .element()
    .getAttribute('src')
  await view.unmount()
  expect(uploads[1]!.signal.aborted).toBe(true)
  expect(revoke).toHaveBeenCalledWith(unfinishedPreview)
})
