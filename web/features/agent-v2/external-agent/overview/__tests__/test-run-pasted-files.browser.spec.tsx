import type { ExternalTestFileResponse } from '@dify/contracts/api/console/external-agents/types.gen'
import { page } from 'vite-plus/test/browser'
import { toast } from '@/app/notifications'
import { createExternalAgentCapabilities } from '@/test/console/external-agents'
import { createDeferred } from '@/test/deferred'
import { act } from '@/test/react-act'
import { guardUnexpectedFetch } from '@/test/unexpected-fetch'
import { renderTestPanel, testResult } from './test-run-fixture'

// boundary: real translations and real form/attachment controls remain mounted.
vi.mock('react-i18next', async (importOriginal) => importOriginal())
const api = vi.hoisted(() => ({
  upload: vi.fn(),
  paste: vi.fn(),
  release: vi.fn(),
  start: vi.fn(),
  leave: vi.fn(),
  capabilities: vi.fn(),
}))
// boundary: the generated service transport supplies actual lease DTOs at its public boundary.
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
      'externalAgents.capabilities.get': api.capabilities,
      'externalAgents.byAgentId.testFiles.post': api.upload,
      'externalAgents.byAgentId.testFiles.pasteLink.post': api.paste,
      'externalAgents.byAgentId.testFiles.byLeaseId.delete': api.release,
      'externalAgents.byAgentId.tests.post': api.start,
    }),
  }
})
const panel = () => page.getByRole('dialog', { name: 'Test agent', exact: true })
const pasteDialog = () => page.getByRole('dialog', { name: 'Paste file link', exact: true })
function lease(overrides: Partial<ExternalTestFileResponse> = {}): ExternalTestFileResponse {
  return {
    lease_id: '77777777-7777-4777-8777-777777777777',
    file_id: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
    filename: 'inferred.pdf',
    media_type: 'application/pdf',
    size: 100,
    expires_at: new Date(Date.now() + 3_600_000).toISOString(),
    url: 'https://files.example.test/input',
    url_expires_at: new Date(Date.now() + 3_600_000).toISOString(),
    ...overrides,
  }
}
async function pasteLink() {
  await panel().getByRole('button', { name: 'Paste file link', exact: true }).click()
  await pasteDialog()
    .getByRole('textbox', { name: 'File link', exact: true })
    .fill('https://files.example.test/download?id=1')
  await pasteDialog().getByRole('button', { name: 'Add', exact: true }).click()
  await expect.element(pasteDialog()).not.toBeInTheDocument()
}
beforeEach(({ onTestFinished }) => {
  onTestFinished(guardUnexpectedFetch())
  onTestFinished(() => toast.dismiss())
  api.capabilities.mockReset().mockResolvedValue(createExternalAgentCapabilities())
  api.upload.mockReset().mockResolvedValue(lease())
  api.paste.mockReset().mockResolvedValue(lease())
  api.release.mockReset().mockResolvedValue(undefined)
  api.start.mockReset().mockResolvedValue(testResult('succeeded'))
  api.leave.mockReset().mockResolvedValue({ result: 'success' })
})

it.each([
  {
    name: 'unsupported inferred MIME',
    mediaType: 'image/png',
    size: 2,
    documentLimit: 1000,
    error: 'This agent does not support this file type.',
  },
  {
    name: 'oversized inferred content',
    mediaType: 'application/pdf',
    size: 100,
    documentLimit: 4,
    error: 'The file exceeds the 4 B limit.',
  },
])(
  'validates $name and retains the URL for a real retry',
  async ({ mediaType, size, documentLimit, error }) => {
    const capabilities = createExternalAgentCapabilities()
    api.capabilities.mockResolvedValue({
      ...capabilities,
      limits: {
        ...capabilities.limits,
        files: {
          max_files: 5,
          max_document_bytes: documentLimit,
          max_image_bytes: 1000,
          max_total_bytes: 1000,
        },
      },
    })
    api.paste
      .mockResolvedValueOnce(lease({ media_type: mediaType, size }))
      .mockResolvedValue(lease({ size: 2 }))
    const rendered = await renderTestPanel()
    onTestFinished(() => rendered.queryClient.clear())
    await page.getByRole('button', { name: 'Test agent', exact: true }).click()
    await panel().getByRole('textbox', { name: 'Task', exact: true }).fill('Read this file.')
    await pasteLink()
    await expect.element(panel().getByText(error, { exact: true })).toBeVisible()
    await expect
      .element(panel().getByRole('button', { name: 'Retry download', exact: true }))
      .toBeVisible()
    await expect
      .element(panel().getByRole('button', { name: 'Run test', exact: true }))
      .toHaveAttribute('aria-disabled', 'true')
    expect(api.release).toHaveBeenCalledExactlyOnceWith({
      params: { agent_id: testResult().metadata.agent_id, lease_id: lease().lease_id },
    })
    expect(api.start).not.toHaveBeenCalled()
    await panel().getByRole('button', { name: 'Retry download', exact: true }).click()
    await expect.element(panel().getByText('inferred.pdf', { exact: true })).toBeVisible()
    await expect
      .element(panel().getByRole('button', { name: 'Run test', exact: true }))
      .toBeEnabled()
    expect(api.paste).toHaveBeenCalledTimes(2)
    expect(api.paste.mock.calls[1]![0]).toEqual(api.paste.mock.calls[0]![0])
    expect(api.paste.mock.calls[0]![0].body).toEqual({
      url: 'https://files.example.test/download?id=1',
      page_session_id: expect.any(String),
    })
  },
)

it('validates a late pasted response against the current concurrent local upload total', async () => {
  const pasted = createDeferred<ExternalTestFileResponse>()
  const uploaded = createDeferred<ExternalTestFileResponse>()
  const capabilities = createExternalAgentCapabilities()
  api.capabilities.mockResolvedValue({
    ...capabilities,
    limits: {
      ...capabilities.limits,
      files: {
        max_files: 5,
        max_document_bytes: 1000,
        max_image_bytes: 1000,
        max_total_bytes: 150,
      },
    },
  })
  api.paste.mockReturnValue(pasted.promise)
  api.upload.mockReturnValue(uploaded.promise)
  const rendered = await renderTestPanel()
  onTestFinished(() => rendered.queryClient.clear())
  await page.getByRole('button', { name: 'Test agent', exact: true }).click()
  await panel().getByRole('textbox', { name: 'Task', exact: true }).fill('Read both files.')
  await pasteLink()
  await panel()
    .getByTestId('external-agent-local-file-input')
    .upload(new File(['x'.repeat(100)], 'notes.txt', { type: 'text/plain' }))
  await expect.poll(() => api.upload.mock.calls.length).toBe(1)
  await act(async () => pasted.resolve(lease()))
  await expect
    .element(panel().getByText('The selected files exceed the 150 B total limit.', { exact: true }))
    .toBeVisible()
  await act(async () =>
    uploaded.resolve(
      lease({
        lease_id: 'cccccccc-cccc-4ccc-8ccc-cccccccccccc',
        filename: 'notes.txt',
        media_type: 'text/plain',
        size: 100,
      }),
    ),
  )
  await expect
    .element(panel().getByRole('button', { name: 'Retry download', exact: true }))
    .toBeVisible()
  await expect
    .element(panel().getByRole('button', { name: 'Run test', exact: true }))
    .toHaveAttribute('aria-disabled', 'true')
  expect(api.release).toHaveBeenCalledExactlyOnceWith({
    params: { agent_id: testResult().metadata.agent_id, lease_id: lease().lease_id },
  })
  expect(api.start).not.toHaveBeenCalled()
})
