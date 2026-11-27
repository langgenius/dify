import { page, userEvent } from 'vite-plus/test/browser'
import { render } from 'vitest-browser-react'
import { createConsoleQueryWrapper } from '@/test/console/query-data'
import { hold, installFakeApi, networkError } from '@/test/fake-api'
import { createKnowledgeSpaceFixture, KnowledgeSpaceTestProvider } from '@/test/knowledge-space'
import { createTestNavigation } from '@/test/next-navigation'
import { QueryTestingAdapter } from '@/test/query-state-testing-adapter'
import { RetrievalTestPage } from '../page'

// boundary: Use real English catalogs for upload control names; locale loading and switching are outside these upload lifecycle tests.
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
const nameOf = (file: Blob) => (file instanceof File ? file.name : '')
const uploaded = (id: string, file: Blob) => ({ id, name: nameOf(file), size: file.size })
const empty = () => ({ data: [], next_cursor: null })

afterEach(() => vi.restoreAllMocks())

async function renderPage() {
  const fake = installFakeApi({
    console: {
      files: {
        upload: {
          post: ({ body }) => uploaded('00000000-0000-4000-8000-000000000000', body.file),
        },
      },
      knowledgeFs: {
        spaces: {
          byControlSpaceId: {
            traces: { get: empty },
            researchTasks: { get: empty },
            settings: {
              get: () => ({
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
            },
          },
        },
      },
    },
  })
  onTestFinished(fake)
  const { wrapper: QueryWrapper } = createConsoleQueryWrapper()
  const { NavigationProvider } = createTestNavigation({ url: '/datasets/new/space-1/retrieval' })
  const view = await render(
    <NavigationProvider>
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
      </QueryWrapper>
    </NavigationProvider>,
  )
  /** Hold the next upload request open so the test controls when the server answers. */
  const holdUpload = () => hold(fake.console.files.upload.post)
  return { view, holdUpload }
}
const input = () => page.getByLabelText('Add images')
const run = () => page.getByRole('button', { name: 'Run' })

it('shows the selected image and its progress immediately, and waits for the server before enabling retrieval', async () => {
  await page.viewport(1280, 800)
  const { holdUpload } = await renderPage()
  const upload = holdUpload()
  const file = imageFile('diagram.png')
  await userEvent.upload(input(), file)
  const thumbnail = page.getByRole('img', { name: 'diagram.png' })
  await expect.element(thumbnail).toBeVisible()
  await expect.poll(() => (thumbnail.element() as HTMLImageElement).naturalWidth).toBe(64)
  const progress = page.getByRole('progressbar', { name: 'Uploading diagram.png' })
  await expect.element(progress).toHaveAttribute('aria-valuenow', '0')
  await upload.arrived
  await expect.element(progress).toBeVisible()
  await expect.element(run()).toBeDisabled()
  upload.resolve(uploaded('11111111-1111-4111-8111-111111111111', file))
  await expect.element(progress).not.toBeInTheDocument()
  await expect.element(thumbnail).toBeVisible()
  await expect.element(run()).toBeEnabled()
})

it('keeps successful images while offering retry for only the failed upload', async () => {
  await page.viewport(600, 720)
  const { holdUpload } = await renderPage()
  const first = holdUpload()
  const second = holdUpload()
  const success = imageFile('success.png')
  const failing = imageFile('retry.png')
  await userEvent.upload(input(), [success, failing])
  expect(nameOf((await first.arrived).body.file)).toBe('success.png')
  expect(nameOf((await second.arrived).body.file)).toBe('retry.png')
  first.resolve(uploaded('22222222-2222-4222-8222-222222222222', success))
  second.reject(networkError())
  const retry = page.getByRole('button', { name: 'Retry retry.png' })
  await expect.element(retry).toBeVisible()
  await expect.element(page.getByRole('alert')).toHaveTextContent('Image upload failed. Try again.')
  await expect.element(page.getByRole('img', { name: 'success.png' })).toBeVisible()
  await expect.element(run()).toBeDisabled()
  const retried = holdUpload()
  await retry.click()
  expect(nameOf((await retried.arrived).body.file)).toBe('retry.png')
  await expect.element(page.getByRole('progressbar')).toBeVisible()
  await expect.element(page.getByRole('alert')).not.toBeInTheDocument()
  retried.resolve(uploaded('33333333-3333-4333-8333-333333333333', failing))
  await expect.element(page.getByRole('progressbar')).not.toBeInTheDocument()
  await expect.element(run()).toBeEnabled()
})

it('cancels removed uploads, ignores late responses and releases previews on removal and unmount', async () => {
  const revoke = vi.spyOn(URL, 'revokeObjectURL')
  const { view, holdUpload } = await renderPage()
  const removed = holdUpload()
  const file = imageFile('removed.png')
  await userEvent.upload(input(), file)
  await removed.arrived
  const thumbnail = page.getByRole('img', { name: 'removed.png' })
  const preview = thumbnail.element().getAttribute('src')
  await page.getByRole('button', { name: 'Remove removed.png' }).click()
  await expect.element(thumbnail).not.toBeInTheDocument()
  expect(revoke).toHaveBeenCalledWith(preview)
  removed.resolve(uploaded('44444444-4444-4444-8444-444444444444', file))
  await expect.element(run()).toBeDisabled()
  await expect.element(page.getByRole('img')).not.toBeInTheDocument()
  const unfinished = holdUpload()
  await userEvent.upload(input(), imageFile('unfinished.png'))
  await unfinished.arrived
  const unfinishedPreview = page
    .getByRole('img', { name: 'unfinished.png' })
    .element()
    .getAttribute('src')
  await view.unmount()
  expect(revoke).toHaveBeenCalledWith(unfinishedPreview)
})
