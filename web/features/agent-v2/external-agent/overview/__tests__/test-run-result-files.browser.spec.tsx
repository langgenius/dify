import type { ExternalTestFileAccessResponse } from '@dify/contracts/api/console/external-agents/types.gen'
import { ORPCError } from '@orpc/client'
import { page } from 'vite-plus/test/browser'
import { toast } from '@/app/notifications'
import { createDeferred } from '@/test/deferred'
import { act } from '@/test/react-act'
import { guardUnexpectedFetch } from '@/test/unexpected-fetch'
import { agentId, childId, renderTestPanel, testOverview, testResult } from './test-run-fixture'

// boundary: the actual Drawer and file controls use the actual application translations.
vi.mock('react-i18next', async (importOriginal) => importOriginal())
const api = vi.hoisted(() => ({
  start: vi.fn(),
  read: vi.fn(),
  access: vi.fn(),
  leave: vi.fn(),
  download: vi.fn<typeof import('@/utils/download').downloadBlob>(),
}))
// boundary: native browser download delivery is owned and tested by the shared download utility.
vi.mock('@/utils/download', () => ({ downloadBlob: api.download }))
// boundary: only remote Console responses are replaced; generated identities and Query ownership stay real.
vi.mock('@/service/console', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/service/console')>()
  const { withConsoleClientResponses, withConsoleResponses } =
    await import('@/test/console/service-responses')
  return {
    ...actual,
    consoleClient: withConsoleClientResponses(actual.consoleClient, {
      'externalAgentTests.leavePage.post': api.leave,
    }),
    consoleQuery: withConsoleResponses(actual.consoleQuery, {
      'externalAgents.capabilities.get': async () =>
        (await import('@/test/console/external-agents')).createExternalAgentCapabilities(),
      'externalAgents.byAgentId.tests.post': api.start,
      'externalAgents.byAgentId.tests.byInvocationId.get': api.read,
      'externalAgents.byAgentId.tests.byInvocationId.files.byFileId.access.get': api.access,
    }),
  }
})
const fileId = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb'
const originalUrl = 'https://files.example.test/report.pdf?signature=original'
const refreshedUrl = 'https://files.example.test/report.pdf?signature=refreshed'
const panel = () => page.getByRole('dialog', { name: 'Test agent', exact: true })
const preview = () => panel().getByRole('link', { name: 'report.pdf', exact: true })
function outputFile(
  url: string | null = originalUrl,
  expires: string | null = new Date(Date.now() + 60_000).toISOString(),
) {
  return {
    dify_model_identity: '__dify__file__',
    upload_file_id: fileId,
    filename: 'report.pdf',
    mime_type: 'application/pdf',
    size: 100,
    url,
    url_expires_at: expires,
  }
}
function useSignatureClock() {
  vi.useFakeTimers({ toFake: ['Date', 'setInterval', 'clearInterval'] })
  vi.setSystemTime(new Date('2026-11-19T10:00:00Z'))
  onTestFinished(() => {
    vi.useRealTimers()
  })
}
async function run() {
  await page.getByRole('button', { name: 'Test agent', exact: true }).click()
  await panel().getByRole('textbox', { name: 'Task', exact: true }).fill('Produce a report.')
  await panel().getByRole('button', { name: 'Run test', exact: true }).click()
}
beforeEach(({ onTestFinished }) => {
  onTestFinished(guardUnexpectedFetch())
  onTestFinished(() => toast.dismiss())
  api.start
    .mockReset()
    .mockImplementation(async () => testResult('succeeded', { outputs: { report: outputFile() } }))
  api.read.mockReset().mockResolvedValue(testResult())
  api.access.mockReset().mockImplementation(async () => ({
    file_id: fileId,
    url: refreshedUrl,
    url_expires_at: new Date(Date.now() + 60_000).toISOString(),
  }))
  api.leave.mockReset().mockResolvedValue({ result: 'success' })
  api.download.mockReset()
})

it('previews nested published files and refreshes expired signatures using the current retry and page ownership', async () => {
  useSignatureClock()
  api.start.mockResolvedValue(testResult())
  api.read.mockImplementation(async () =>
    testResult('succeeded', {
      invocation_id: childId,
      outputs: { bundle: { files: [outputFile()], note: 'The actual agent report.' } },
    }),
  )
  const refreshed = createDeferred<ExternalTestFileAccessResponse>()
  api.access.mockReturnValue(refreshed.promise)
  const rendered = await renderTestPanel()
  onTestFinished(() => rendered.queryClient.clear())
  await run()
  await expect
    .element(panel().getByRole('status').getByText('Running', { exact: true }))
    .toBeVisible()
  await act(async () => {
    await vi.advanceTimersByTimeAsync(1_500)
  })
  await expect.element(preview()).toHaveAttribute('href', originalUrl)
  await expect.element(panel().getByText('The actual agent report.', { exact: true })).toBeVisible()
  expect(api.access).not.toHaveBeenCalled()
  await act(async () => {
    await vi.advanceTimersByTimeAsync(60_000)
  })
  await expect.poll(() => api.access.mock.calls.length).toBe(1)
  await expect.element(preview()).not.toBeInTheDocument()
  await expect
    .element(panel().getByRole('button', { name: 'Download', exact: true }))
    .toBeDisabled()
  expect(api.access.mock.calls[0]![0]).toEqual({
    params: { agent_id: agentId, invocation_id: childId, file_id: fileId },
    query: {
      expected_generation: 1,
      page_session_id: api.start.mock.calls[0]![0].body.page_session_id,
    },
  })
  await act(async () =>
    refreshed.resolve({
      file_id: fileId,
      url: refreshedUrl,
      url_expires_at: new Date(Date.now() + 60_000).toISOString(),
    }),
  )
  await expect.element(preview()).toHaveAttribute('href', refreshedUrl)
  await expect.element(preview()).toHaveAttribute('target', '_blank')
  await panel().getByRole('button', { name: 'Close', exact: true }).click()
  await expect.element(panel()).not.toBeInTheDocument()
  await act(async () => {
    await vi.advanceTimersByTimeAsync(120_000)
  })
  expect(api.access).toHaveBeenCalledTimes(1)
})

it('downloads signed bytes as a Blob without Console credentials and retains the server filename', async () => {
  useSignatureClock()
  const bytes = vi.fn<typeof fetch>().mockResolvedValue(
    new Response('real report bytes', {
      headers: { 'Content-Type': 'application/pdf' },
    }),
  )
  // boundary: signed file bytes are supplied at the network boundary, independently of generated Console metadata.
  vi.stubGlobal('fetch', bytes)
  const rendered = await renderTestPanel()
  onTestFinished(() => rendered.queryClient.clear())
  await run()
  await expect.element(preview()).toBeVisible()
  await panel().getByRole('button', { name: 'Download', exact: true }).click()
  await expect.poll(() => api.download.mock.calls.length).toBe(1)
  expect(bytes).toHaveBeenCalledExactlyOnceWith(originalUrl, {
    credentials: 'omit',
    signal: expect.any(AbortSignal),
  })
  const { data: blob, fileName } = api.download.mock.calls[0]![0]
  expect(blob).toBeInstanceOf(Blob)
  expect(await blob.text()).toBe('real report bytes')
  expect(fileName).toBe('report.pdf')
  expect(api.access).not.toHaveBeenCalled()
})

it('removes expired hrefs after ownership or source-lease loss and stops refreshing them', async () => {
  useSignatureClock()
  api.access.mockRejectedValue(
    new ORPCError('GONE', { status: 410, message: 'File lease expired.' }),
  )
  const rendered = await renderTestPanel()
  onTestFinished(() => rendered.queryClient.clear())
  await run()
  await expect.element(preview()).toHaveAttribute('href', originalUrl)
  await act(async () => {
    await vi.advanceTimersByTimeAsync(60_000)
  })
  await expect
    .element(panel().getByText('This file is no longer available.', { exact: true }))
    .toBeVisible()
  await expect.element(preview()).not.toBeInTheDocument()
  await expect
    .element(panel().getByRole('button', { name: 'Download', exact: true }))
    .toBeDisabled()
  await expect
    .element(panel().getByRole('button', { name: 'Retry', exact: true }))
    .not.toBeInTheDocument()
  await act(async () => {
    await vi.advanceTimersByTimeAsync(180_000)
  })
  expect(api.access).toHaveBeenCalledTimes(1)
})

it('keeps unavailable output metadata without trying to revive a known expired source file', async () => {
  useSignatureClock()
  api.start.mockResolvedValue(
    testResult('succeeded', { outputs: { report: outputFile(null, null) } }),
  )
  const rendered = await renderTestPanel()
  onTestFinished(() => rendered.queryClient.clear())
  await run()
  await expect.element(panel().getByText('report.pdf', { exact: true })).toBeVisible()
  await expect
    .element(panel().getByText('This file is no longer available.', { exact: true }))
    .toBeVisible()
  await expect.element(preview()).not.toBeInTheDocument()
  await act(async () => {
    await vi.advanceTimersByTimeAsync(180_000)
  })
  expect(api.access).not.toHaveBeenCalled()
})

it('does not reuse an old generation signature response for a new run', async () => {
  useSignatureClock()
  const stale = createDeferred<ExternalTestFileAccessResponse>()
  api.access.mockReturnValue(stale.promise)
  const rendered = await renderTestPanel()
  onTestFinished(() => rendered.queryClient.clear())
  await run()
  await expect.element(preview()).toHaveAttribute('href', originalUrl)
  await act(async () => {
    await vi.advanceTimersByTimeAsync(60_000)
  })
  await expect.poll(() => api.access.mock.calls.length).toBe(1)
  const overview = testOverview()
  await rendered.rerenderOverview({
    ...overview,
    asset: { ...overview.asset, test_display_generation: 2 },
  })
  await expect.element(preview()).not.toBeInTheDocument()
  const newUrl = 'https://files.example.test/report.pdf?signature=new-generation'
  api.start.mockResolvedValue(
    testResult('succeeded', {
      metadata: { ...testResult().metadata, test_generation: 2 },
      outputs: { report: outputFile(newUrl) },
    }),
  )
  await panel().getByRole('button', { name: 'Run test', exact: true }).click()
  await expect.element(preview()).toHaveAttribute('href', newUrl)
  await act(async () =>
    stale.resolve({
      file_id: fileId,
      url: refreshedUrl,
      url_expires_at: new Date(Date.now() + 60_000).toISOString(),
    }),
  )
  await expect.element(preview()).toHaveAttribute('href', newUrl)
  expect(api.start.mock.calls[1]![0].body.expected_generation).toBe(2)
})
