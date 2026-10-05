import { page, userEvent } from 'vite-plus/test/browser'
import { cleanup, render } from 'vitest-browser-react'
import { defaultAgentSoulConfigFormState } from '@/features/agent-v2/agent-composer/form-state'
import { AgentComposerProvider } from '@/features/agent-v2/agent-composer/provider'
import { commonQueryKeys } from '@/service/use-common'
import { createConsoleQueryWrapper } from '@/test/console/query-data'
import { QueryClientTestProvider } from '@/test/console/query-provider'
import { AgentOrchestrateAddActionsProvider } from '../../add-actions'
import { AgentConfigApiContextProvider } from '../../config-context'
import { AgentSkills } from '../index'

const { transport } = vi.hoisted(() => ({ transport: vi.fn() }))
vi.mock('@/service/console/browser', () => ({ consoleBrowserLink: { call: transport } }))

const clients: ReturnType<typeof createConsoleQueryWrapper>['queryClient'][] = []
const skill = {
  id: 'Preview Skill',
  name: 'Preview Skill',
  fileId: 'skill-file',
  description: 'Preview session fixture',
}
const inspect = {
  id: skill.id,
  name: skill.name,
  description: skill.description,
  source: 'config_skill_zip',
  files: [
    { path: 'SKILL.md', name: 'SKILL.md', type: 'file', previewable: true, downloadable: true },
    { path: 'guide.md', name: 'guide.md', type: 'file', previewable: true, downloadable: true },
    { path: 'image.png', name: 'image.png', type: 'file', previewable: true, downloadable: true },
  ],
  skill_md: {
    path: 'SKILL.md',
    size: 16,
    truncated: false,
    binary: false,
    text: '# Preview Skill',
  },
  warnings: [],
}

async function renderSkills() {
  const { queryClient } = createConsoleQueryWrapper({ features: { enable_skill: false } })
  clients.push(queryClient)
  queryClient.setQueryData(commonQueryKeys.fileUploadConfig, { skill_file_size_limit: 64 })
  return render(
    <QueryClientTestProvider queryClient={queryClient}>
      <AgentConfigApiContextProvider value={{ agentId: 'agent-1', draftType: 'draft' }}>
        <AgentComposerProvider
          initialDraft={{ ...defaultAgentSoulConfigFormState, skills: [skill] }}
        >
          <AgentOrchestrateAddActionsProvider>
            <AgentSkills />
          </AgentOrchestrateAddActionsProvider>
        </AgentComposerProvider>
      </AgentConfigApiContextProvider>
    </QueryClientTestProvider>,
  )
}

beforeEach(async () => {
  ;(
    globalThis as typeof globalThis & { BASE_UI_ANIMATIONS_DISABLED: boolean }
  ).BASE_UI_ANIMATIONS_DISABLED = false
  await page.viewport(1200, 900)
  transport.mockReset()
  transport.mockImplementation(async (path: string[], input: { query?: { path?: string } }) => {
    const operation = path.join('.')
    if (operation === 'agent.byAgentId.config.skills.byName.inspect.get') return inspect
    if (operation === 'agent.byAgentId.config.skills.byName.files.preview.get')
      return {
        path: input.query?.path,
        binary: false,
        truncated: false,
        text: 'Selected guide content',
      }
    if (operation === 'agent.byAgentId.config.skills.byName.files.download.get')
      return { url: '/skill-preview-image' }
    throw new Error(`Unexpected transport: ${operation}`)
  })
})

afterEach(async () => {
  await cleanup()
  clients.splice(0).forEach((client) => client.clear())
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
  ;(
    globalThis as typeof globalThis & { BASE_UI_ANIMATIONS_DISABLED: boolean }
  ).BASE_UI_ANIMATIONS_DISABLED = true
})

it('retains the selected file through exit and reopens it from the actual skill row', async () => {
  const screen = await renderSkills()
  const entry = screen.getByRole('button', { name: skill.name, exact: true })
  await entry.click()
  await expect.element(page.getByText('# Preview Skill', { exact: true })).toBeVisible()
  await page.getByRole('button', { name: 'guide.md', exact: true }).click()
  const dialog = page.getByRole('dialog', { name: 'guide.md', exact: true })
  await expect.element(dialog.getByText('Selected guide content', { exact: true })).toBeVisible()
  const popup = dialog.element()
  const content = dialog.getByText('Selected guide content', { exact: true }).element()
  const exitContent: boolean[] = []
  popup.addEventListener('transitionrun', () => {
    if (popup.hasAttribute('data-ending-style')) exitContent.push(content.isConnected)
  })
  await dialog.getByRole('button', { name: 'common.operation.close' }).click()
  await expect.poll(() => exitContent.length).toBeGreaterThan(0)
  expect(exitContent.every(Boolean)).toBe(true)
  await expect.poll(() => popup.isConnected).toBe(false)
  await expect.element(entry).toHaveFocus()
  expect(entry.element().checkVisibility({ opacityProperty: true })).toBe(true)

  await userEvent.keyboard('{Enter}')
  await expect.element(page.getByRole('dialog', { name: 'guide.md', exact: true })).toBeVisible()
  await expect.element(page.getByText('Selected guide content', { exact: true })).toBeVisible()
  const reopened = page.getByRole('dialog').element()
  await userEvent.keyboard('{Escape}')
  await expect.poll(() => reopened.isConnected).toBe(false)
  await expect.element(entry).toHaveFocus()
})

it('keeps the selected image URL alive during exit and releases it after the popup detaches', async () => {
  const blob = new Blob(
    [
      '<svg xmlns="http://www.w3.org/2000/svg" width="200" height="100"><rect width="200" height="100" fill="teal" /></svg>',
    ],
    { type: 'image/svg+xml' },
  )
  vi.stubGlobal(
    'fetch',
    vi.fn(async () => new Response(blob)),
  )
  const revoke = vi.spyOn(URL, 'revokeObjectURL')
  const screen = await renderSkills()
  await screen.getByRole('button', { name: skill.name, exact: true }).click()
  await page.getByRole('button', { name: 'image.png', exact: true }).click()
  const dialog = page.getByRole('dialog', { name: 'image.png', exact: true })
  const image = dialog.getByRole('img', { name: 'image.png', exact: true })
  await expect.element(image).toBeVisible()
  const element = image.element() as HTMLImageElement
  await expect.poll(() => element.complete && element.naturalWidth > 0).toBe(true)
  const imageUrl = element.src
  const popup = dialog.element()
  await expect
    .poll(() => popup.getAnimations().some((animation) => animation.playState === 'running'))
    .toBe(false)
  const exitImages: boolean[] = []
  popup.addEventListener('transitionrun', () => {
    if (popup.hasAttribute('data-ending-style'))
      exitImages.push(element.isConnected && !revoke.mock.calls.some(([url]) => url === imageUrl))
  })
  await dialog.getByRole('button', { name: 'common.operation.close' }).click()
  await expect.poll(() => exitImages.length).toBeGreaterThan(0)
  expect(exitImages.every(Boolean)).toBe(true)
  await expect.poll(() => popup.isConnected).toBe(false)
  expect(revoke).toHaveBeenCalledWith(imageUrl)
})

it('retains the failed image preview message during exit', async () => {
  vi.stubGlobal(
    'fetch',
    vi.fn(async () => new Response('', { status: 500 })),
  )
  const screen = await renderSkills()
  await screen.getByRole('button', { name: skill.name, exact: true }).click()
  await page.getByRole('button', { name: 'image.png', exact: true }).click()
  const dialog = page.getByRole('dialog', { name: 'image.png', exact: true })
  const error = dialog.getByText('agentV2.agentDetail.configure.files.preview.failed', {
    exact: true,
  })
  await expect.element(error).toBeVisible()
  const errorElement = error.element()
  const popup = dialog.element()
  await expect
    .poll(() => popup.getAnimations().some((animation) => animation.playState === 'running'))
    .toBe(false)
  const exitErrors: boolean[] = []
  popup.addEventListener('transitionrun', () => {
    if (popup.hasAttribute('data-ending-style')) exitErrors.push(errorElement.isConnected)
  })
  await dialog.getByRole('button', { name: 'common.operation.close' }).click()
  await expect.poll(() => exitErrors.length).toBeGreaterThan(0)
  expect(exitErrors.every(Boolean)).toBe(true)
})
