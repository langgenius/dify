import { page } from 'vite-plus/test/browser'
import { toast } from '@/app/notifications'
import { createExternalAgentCapabilities } from '@/test/console/external-agents'
import { guardUnexpectedFetch } from '@/test/unexpected-fetch'
import { renderTestPanel, testOverview, testResult } from './test-run-fixture'

// boundary: this fixture supplies actual translations for the real forms and controls.
vi.mock('react-i18next', async (importOriginal) => importOriginal())
const api = vi.hoisted(() => ({
  upload: vi.fn(),
  paste: vi.fn(),
  release: vi.fn(),
  start: vi.fn(),
  leave: vi.fn(),
  capabilities: vi.fn(),
}))
// boundary: generated Console responses own remote file leases; no fake upload or interactive child is substituted.
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
const leaseId = '77777777-7777-4777-8777-777777777777'
beforeEach(({ onTestFinished }) => {
  onTestFinished(guardUnexpectedFetch())
  onTestFinished(() => toast.dismiss())
  api.capabilities.mockReset().mockResolvedValue(createExternalAgentCapabilities())
  api.upload.mockReset().mockImplementation(async ({ body }) => ({
    lease_id: leaseId,
    file_id: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
    filename: body.file.name,
    media_type: body.file.type,
    size: body.file.size,
    expires_at: new Date(Date.now() + 3_600_000).toISOString(),
  }))
  api.paste.mockReset().mockResolvedValue({
    lease_id: leaseId,
    file_id: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
    filename: 'contract.pdf',
    media_type: 'application/pdf',
    size: 100,
    expires_at: new Date(Date.now() + 3_600_000).toISOString(),
  })
  api.release.mockReset().mockResolvedValue(undefined)
  api.start.mockReset().mockResolvedValue(testResult('succeeded'))
  api.leave.mockReset().mockResolvedValue({ result: 'success' })
})

it('uses server leases for pasted files, preserves them on panel close and submits only explicit lease IDs', async () => {
  const rendered = await renderTestPanel()
  onTestFinished(() => rendered.queryClient.clear())
  await page.getByRole('button', { name: 'Test agent', exact: true }).click()
  await expect
    .element(panel().getByRole('button', { name: 'Local Upload', exact: false }))
    .toBeEnabled()
  await panel().getByRole('button', { name: 'Paste file link', exact: true }).click()
  await pasteDialog()
    .getByRole('textbox', { name: 'File link', exact: true })
    .fill('https://files.example.test/download?id=1')
  await pasteDialog().getByRole('textbox', { name: 'Filename', exact: true }).fill('contract.pdf')
  await pasteDialog().getByRole('combobox', { name: 'File type', exact: true }).click()
  await page.getByRole('option', { name: 'PDF', exact: true }).click()
  await pasteDialog().getByRole('button', { name: 'Add', exact: true }).click()
  await expect
    .element(panel().getByRole('button', { name: 'Remove contract.pdf', exact: true }))
    .toBeVisible()
  expect(api.start).not.toHaveBeenCalled()
  expect(api.paste.mock.calls[0]![0].body).toMatchObject({
    url: 'https://files.example.test/download?id=1',
    filename: 'contract.pdf',
    media_type: 'application/pdf',
  })
  await panel().getByRole('button', { name: 'Close', exact: true }).click()
  await expect.element(panel()).not.toBeInTheDocument()
  expect(api.leave).not.toHaveBeenCalled()
  await page.getByRole('button', { name: 'Test agent', exact: true }).click()
  await expect.element(panel().getByText('contract.pdf', { exact: true })).toBeVisible()
  const overview = testOverview()
  await rendered.rerenderOverview({
    ...overview,
    asset: { ...overview.asset, test_display_generation: 2 },
  })
  api.start.mockResolvedValue(
    testResult('succeeded', { metadata: { ...testResult().metadata, test_generation: 2 } }),
  )
  await expect.element(panel().getByText('contract.pdf', { exact: true })).toBeVisible()
  await panel()
    .getByRole('textbox', { name: 'Task', exact: true })
    .fill('Review the attached contract.')
  await panel().getByRole('button', { name: 'Run test', exact: true }).click()
  await expect
    .element(panel().getByRole('status').getByText('Success', { exact: true }))
    .toBeVisible()
  expect(api.start.mock.calls[0]![0].body.input_lease_ids).toEqual([leaseId])
  expect(api.start.mock.calls[0]![0].body.expected_generation).toBe(2)
  expect(api.start.mock.calls[0]![0].body.page_session_id).toBe(
    api.paste.mock.calls[0]![0].body.page_session_id,
  )
  await panel().getByRole('button', { name: 'Remove contract.pdf', exact: true }).click()
  await expect.element(panel().getByText('contract.pdf', { exact: true })).not.toBeInTheDocument()
  expect(api.release).toHaveBeenCalledWith({
    params: { agent_id: testResult().metadata.agent_id, lease_id: leaseId },
  })
  expect(api.start).toHaveBeenCalledTimes(1)
})

it('uploads a local file, keeps its lease in the page session and submits its ID', async () => {
  const rendered = await renderTestPanel()
  onTestFinished(() => rendered.queryClient.clear())
  await page.getByRole('button', { name: 'Test agent', exact: true }).click()
  const file = new File(['Review this text.'], 'notes.txt', { type: 'text/plain' })
  await panel().getByTestId('external-agent-local-file-input').upload(file)
  await expect
    .element(panel().getByRole('button', { name: 'Remove notes.txt', exact: true }))
    .toBeVisible()
  expect(api.upload).toHaveBeenCalledTimes(1)
  const input = api.upload.mock.calls[0]![0]
  expect(input.params.agent_id).toBe(testResult().metadata.agent_id)
  expect(input.body.file.name).toBe(file.name)
  expect(input.body.file.type).toBe(file.type)
  expect(input.body.page_session_id).toBeTruthy()
  await panel().getByRole('textbox', { name: 'Task', exact: true }).fill('Read the attachment.')
  await panel().getByRole('button', { name: 'Run test', exact: true }).click()
  await expect
    .element(panel().getByRole('status').getByText('Success', { exact: true }))
    .toBeVisible()
  expect(api.start.mock.calls[0]![0].body.input_lease_ids).toEqual([leaseId])
  expect(api.start.mock.calls[0]![0].body.page_session_id).toBe(input.body.page_session_id)
})

it('rejects a local file above the effective document size limit before upload', async () => {
  const capabilities = createExternalAgentCapabilities()
  api.capabilities.mockResolvedValue({
    ...capabilities,
    limits: {
      ...capabilities.limits,
      files: {
        max_files: 5,
        max_document_bytes: 4,
        max_image_bytes: 1000,
        max_total_bytes: 1000,
      },
    },
  })
  const rendered = await renderTestPanel()
  onTestFinished(() => rendered.queryClient.clear())
  await page.getByRole('button', { name: 'Test agent', exact: true }).click()
  await panel()
    .getByTestId('external-agent-local-file-input')
    .upload(new File(['too large'], 'notes.txt', { type: 'text/plain' }))
  await expect.element(panel().getByRole('alert')).toBeVisible()
  expect(api.upload).not.toHaveBeenCalled()
})

it('rejects HTTP links and enforces the effective file count before preparing another lease', async () => {
  const capabilities = createExternalAgentCapabilities()
  api.capabilities.mockResolvedValue({
    ...capabilities,
    limits: {
      ...capabilities.limits,
      files: {
        max_files: 1,
        max_document_bytes: 1000,
        max_image_bytes: 1000,
        max_total_bytes: 1000,
      },
    },
  })
  const rendered = await renderTestPanel()
  onTestFinished(() => rendered.queryClient.clear())
  await page.getByRole('button', { name: 'Test agent', exact: true }).click()
  await panel().getByRole('button', { name: 'Paste file link', exact: true }).click()
  await pasteDialog()
    .getByRole('textbox', { name: 'File link', exact: true })
    .fill('http://files.example.test/contract.pdf')
  await pasteDialog().getByRole('button', { name: 'Add', exact: true }).click()
  await expect
    .element(pasteDialog().getByText('Enter an HTTPS file link.', { exact: true }))
    .toBeVisible()
  expect(api.paste).not.toHaveBeenCalled()
  await pasteDialog()
    .getByRole('textbox', { name: 'File link', exact: true })
    .fill('https://files.example.test/contract.pdf')
  await pasteDialog().getByRole('button', { name: 'Add', exact: true }).click()
  await expect.element(pasteDialog()).not.toBeInTheDocument()
  await expect.element(panel().getByText('contract.pdf', { exact: true })).toBeVisible()
  await panel().getByRole('button', { name: 'Paste file link', exact: true }).click()
  await pasteDialog()
    .getByRole('textbox', { name: 'File link', exact: true })
    .fill('https://files.example.test/second.pdf')
  await pasteDialog().getByRole('button', { name: 'Add', exact: true }).click()
  await expect.element(panel().getByText('Choose at most 1 files.', { exact: true })).toBeVisible()
  expect(api.paste).toHaveBeenCalledTimes(1)
  expect(api.start).not.toHaveBeenCalled()
})
