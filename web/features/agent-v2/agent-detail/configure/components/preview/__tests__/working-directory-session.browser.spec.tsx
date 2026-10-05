import { page, userEvent } from 'vite-plus/test/browser'
import { cleanup, render } from 'vitest-browser-react'
import { consoleQuery } from '@/service/console'
import { createConsoleQueryWrapper } from '@/test/console/query-data'
import { QueryClientTestProvider } from '@/test/console/query-provider'
import { AgentPreviewHeader } from '../header'
import { useAgentWorkingDirectoryPanel } from '../hook/use-working-directory-panel'

const { transport } = vi.hoisted(() => ({ transport: vi.fn() }))
vi.mock('@/service/console/browser', () => ({ consoleBrowserLink: { call: transport } }))
const clients: ReturnType<typeof createConsoleQueryWrapper>['queryClient'][] = []
const fileSystem = 'agentV2.agentDetail.configure.workingDirectory.fileSystem'
const temporaryFiles = 'agentV2.agentDetail.configure.workingDirectory.temporaryFiles'
const persistentFiles = 'agentV2.agentDetail.configure.workingDirectory.persistentFiles'

function WorkingDirectoryOwner() {
  const { panel, openWorkingDirectory } = useAgentWorkingDirectoryPanel({
    type: 'agent',
    agentId: 'agent-1',
    caller: { type: 'build_draft', id: 'draft-1' },
  })
  return (
    <>
      <AgentPreviewHeader
        mode="build"
        previewEnabled
        isChatFeaturesOpen={false}
        showWorkingDirectoryAction
        showChatFeaturesAction={false}
        onModeChange={() => {}}
        onToggleChatFeatures={() => {}}
        onOpenWorkingDirectory={openWorkingDirectory}
        onRefresh={() => {}}
      />
      {panel}
    </>
  )
}
async function renderOwner() {
  const { queryClient } = createConsoleQueryWrapper()
  clients.push(queryClient)
  const screen = await render(
    <QueryClientTestProvider queryClient={queryClient}>
      <WorkingDirectoryOwner />
    </QueryClientTestProvider>,
  )
  return { screen, queryClient }
}
beforeEach(async () => {
  vi.stubGlobal('BASE_UI_ANIMATIONS_DISABLED', false)
  await page.viewport(1200, 900)
  transport.mockReset()
  transport.mockImplementation(async (path: string[], input: { query?: { path?: string } }) => {
    const operation = path.join('.')
    if (operation === 'agent.byAgentId.sandbox.files.get')
      return {
        entries:
          input.query?.path === '.'
            ? [{ name: 'temporary.txt', type: 'file' }]
            : [
                { name: 'saved.txt', type: 'file' },
                { name: 'image.png', type: 'file' },
              ],
      }
    if (operation === 'agent.byAgentId.sandbox.files.read.get')
      return {
        text: `Contents of ${input.query?.path}`,
        binary: false,
        truncated: false,
      }
    if (operation === 'agent.byAgentId.sandbox.files.download.post')
      throw new Error('Image preview unavailable')
    throw new Error(`Unexpected transport: ${operation}`)
  })
})
afterEach(async () => {
  await cleanup()
  clients.splice(0).forEach((client) => client.clear())
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
})
it('keeps the directory through exit, restores header focus, and reopens saved root without closed queries', async () => {
  const { screen, queryClient } = await renderOwner()
  expect(transport).not.toHaveBeenCalled()
  const entry = screen.getByRole('button', { name: fileSystem, exact: true })
  await entry.click()
  await expect.element(page.getByRole('dialog', { name: 'saved.txt', exact: true })).toBeVisible()
  const savedTab = page.getByRole('tab', { name: persistentFiles, exact: true })
  for (let step = 0; step < 12 && document.activeElement !== savedTab.element(); step++)
    await userEvent.tab()
  await expect.element(savedTab).toHaveFocus()
  await userEvent.keyboard('{ArrowRight}{Enter}')
  await expect
    .element(page.getByRole('tab', { name: temporaryFiles, exact: true }))
    .toHaveAttribute('aria-selected', 'true')
  const dialog = page.getByRole('dialog', { name: 'temporary.txt', exact: true })
  const content = dialog.getByText('Contents of ./temporary.txt', { exact: true })
  await expect.element(content).toBeVisible()
  const popup = dialog.element()
  const contentElement = content.element()
  await expect
    .poll(
      () =>
        popup.hasAttribute('data-starting-style') ||
        popup.getAnimations().some((animation) => animation.playState === 'running'),
    )
    .toBe(false)
  const exitContent: boolean[] = []
  popup.addEventListener('transitionrun', () => {
    if (popup.hasAttribute('data-ending-style')) exitContent.push(contentElement.isConnected)
  })
  await dialog.getByRole('button', { name: 'common.operation.close' }).click()
  await expect.poll(() => exitContent.length).toBeGreaterThan(0)
  expect(exitContent.every(Boolean)).toBe(true)
  await expect.poll(() => popup.isConnected).toBe(false)
  await expect.element(entry).toHaveFocus()
  expect(entry.element().checkVisibility({ opacityProperty: true })).toBe(true)
  const callsAfterClose = transport.mock.calls.length
  await Promise.all([
    queryClient.invalidateQueries({
      queryKey: consoleQuery.agent.byAgentId.sandbox.files.get.key({ type: 'query' }),
    }),
    queryClient.invalidateQueries({
      queryKey: consoleQuery.agent.byAgentId.sandbox.files.read.get.key({ type: 'query' }),
    }),
  ])
  expect(transport).toHaveBeenCalledTimes(callsAfterClose)
  await userEvent.keyboard('{Enter}')
  await expect.element(page.getByRole('dialog', { name: 'saved.txt', exact: true })).toBeVisible()
  await expect
    .element(page.getByRole('tab', { name: persistentFiles, exact: true }))
    .toHaveAttribute('aria-selected', 'true')
  await userEvent.keyboard('{Escape}')
  await expect.element(entry).toHaveFocus()
})
it('retains the selected image error through Escape and returns to the real header entry', async () => {
  const { screen } = await renderOwner()
  const entry = screen.getByRole('button', { name: fileSystem, exact: true })
  await entry.click()
  await page.getByRole('button', { name: 'image.png', exact: true }).click()
  const dialog = page.getByRole('dialog', { name: 'image.png', exact: true })
  const error = dialog.getByText('agentV2.agentDetail.configure.files.preview.failed', {
    exact: true,
  })
  await expect.element(error).toBeVisible()
  const popup = dialog.element()
  const errorElement = error.element()
  await expect
    .poll(
      () =>
        popup.hasAttribute('data-starting-style') ||
        popup.getAnimations().some((animation) => animation.playState === 'running'),
    )
    .toBe(false)
  const exitErrors: boolean[] = []
  popup.addEventListener('transitionrun', () => {
    if (popup.hasAttribute('data-ending-style')) exitErrors.push(errorElement.isConnected)
  })
  await userEvent.keyboard('{Escape}')
  await expect.poll(() => exitErrors.length).toBeGreaterThan(0)
  expect(exitErrors.every(Boolean)).toBe(true)
  await expect.poll(() => popup.isConnected).toBe(false)
  await expect.element(entry).toHaveFocus()
})
