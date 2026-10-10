import type { Features } from '../../types'
import { NuqsTestingAdapter } from 'nuqs/adapters/testing'
import { useState } from 'react'
import { page, userEvent } from 'vite-plus/test/browser'
import { cleanup, render } from 'vitest-browser-react'
import { ModelTypeEnum } from '@/app/components/header/account-setting/model-provider-page/declarations'
import { ModalContextProvider } from '@/context/modal-context-provider'
import { commonQueryKeys } from '@/service/use-common'
import { createConsoleQueryWrapper } from '@/test/console/query-data'
import { QueryClientTestProvider } from '@/test/console/query-provider'
import { FeaturesProvider } from '../../context'
import { createFeaturesStore } from '../../store'
import NewFeaturePanel from '../index'

const clients: ReturnType<typeof createConsoleQueryWrapper>['queryClient'][] = []
const onChange = vi.fn()
const onUrlUpdate = vi.fn()

function PanelOwner() {
  const [show, setShow] = useState(false)
  return (
    <>
      <button type="button" onClick={() => setShow(true)}>
        Features
      </button>
      <NewFeaturePanel
        show={show}
        onClose={() => setShow(false)}
        isChatMode
        disabled={false}
        showFileUpload={false}
        showAnnotationReply={false}
        onChange={onChange}
      />
    </>
  )
}

async function renderPanel(overrides: Partial<Features> = {}) {
  const { queryClient } = createConsoleQueryWrapper()
  clients.push(queryClient)
  for (const type of [ModelTypeEnum.speech2text, ModelTypeEnum.tts])
    queryClient.setQueryData(commonQueryKeys.defaultModel(type), { data: null })
  queryClient.setQueryData(commonQueryKeys.codeBasedExtensions('moderation'), { data: [] })
  queryClient.setQueryData(commonQueryKeys.modelProviderDetails, { data: [] })
  const features: Features = {
    ...createFeaturesStore().getState().features,
    opening: {
      enabled: true,
      opening_statement: 'Welcome',
      suggested_questions: ['First question'],
    },
    moderation: {
      enabled: true,
      type: 'keywords',
      config: {
        keywords: 'blocked',
        inputs_config: { enabled: true, preset_response: 'Please retry' },
        outputs_config: { enabled: false },
      },
    },
    ...overrides,
  }
  const screen = await render(
    <QueryClientTestProvider queryClient={queryClient}>
      <NuqsTestingAdapter hasMemory onUrlUpdate={onUrlUpdate}>
        <FeaturesProvider features={features}>
          <ModalContextProvider>
            <PanelOwner />
          </ModalContextProvider>
        </FeaturesProvider>
      </NuqsTestingAdapter>
    </QueryClientTestProvider>,
  )
  await screen.getByRole('button', { name: 'Features', exact: true }).click()
  await expect.element(page.getByRole('dialog', { name: 'workflow.common.features' })).toBeVisible()
  return screen
}

beforeEach(async () => {
  await page.viewport(1280, 900)
  onChange.mockClear()
  onUrlUpdate.mockClear()
  ;(
    globalThis as typeof globalThis & { BASE_UI_ANIMATIONS_DISABLED: boolean }
  ).BASE_UI_ANIMATIONS_DISABLED = false
  vi.spyOn(globalThis, 'fetch').mockImplementation(async (input) => {
    const url = input instanceof Request ? input.url : String(input)
    if (url.includes('/default-model?')) return Response.json({ data: null })
    if (url.includes('/code-based-extension?') || url.endsWith('/model-providers'))
      return Response.json({ data: [] })
    throw new Error(`Unexpected request: ${url}`)
  })
})
afterEach(async () => {
  await cleanup()
  clients.splice(0).forEach((client) => client.clear())
  vi.restoreAllMocks()
  ;(
    globalThis as typeof globalThis & { BASE_UI_ANIMATIONS_DISABLED: boolean }
  ).BASE_UI_ANIMATIONS_DISABLED = true
})

it.each([
  {
    entryName: 'appDebug.openingStatement.writeOpener',
    title: 'appDebug.feature.conversationOpener.title',
    source: 'Welcome',
    kind: 'opening',
  },
  {
    entryName: 'common.operation.settings',
    title: 'appDebug.feature.moderation.modal.title',
    source: 'blocked',
    kind: 'moderation',
  },
])(
  'opens $kind from the real feature drawer by keyboard and restores its session after cancellation',
  async ({ entryName, title, source, kind }) => {
    await renderPanel()
    const entry = page.getByRole('button', { name: entryName, exact: true })
    await expect.element(entry).toBeInTheDocument()
    for (let index = 0; index < 12 && document.activeElement !== entry.element(); index++)
      await userEvent.tab()
    await expect.element(entry).toHaveFocus()
    expect(entry.element().checkVisibility({ opacityProperty: true })).toBe(true)
    await userEvent.keyboard('{Enter}')
    const modal = page.getByRole('dialog', { name: title, exact: true })
    await expect.element(modal).toBeVisible()
    const drawer = page.getByRole('dialog', { name: 'workflow.common.features' })
    await expect.element(drawer).not.toBeInTheDocument()
    const editor =
      kind === 'opening'
        ? modal.getByRole('textbox').first()
        : modal.getByRole('textbox', {
            name: 'appDebug.feature.moderation.modal.provider.keywords',
          })
    await editor.fill('Discarded draft')
    await userEvent.keyboard('{Enter}')
    expect(onChange).not.toHaveBeenCalled()
    const popup = modal.element()
    const exitDrafts: string[] = []
    const editorElement = editor.element()
    popup.addEventListener('transitionrun', () => {
      if (popup.hasAttribute('data-ending-style'))
        exitDrafts.push(
          editorElement instanceof HTMLTextAreaElement
            ? editorElement.value
            : (editorElement.textContent ?? ''),
        )
    })
    await userEvent.keyboard('{Escape}')
    await expect.poll(() => exitDrafts.length).toBeGreaterThan(0)
    expect(exitDrafts.every((value) => value.includes('Discarded draft'))).toBe(true)
    await expect.element(modal).not.toBeInTheDocument()
    await expect.element(drawer).toBeVisible()
    expect(onChange).toHaveBeenCalledExactlyOnceWith()
    await userEvent.tab()
    expect(drawer.element().contains(document.activeElement)).toBe(true)
    for (let index = 0; index < 12 && document.activeElement !== entry.element(); index++)
      await userEvent.tab()
    await expect.element(entry).toHaveFocus()
    await expect.poll(() => popup.isConnected).toBe(false)
    await userEvent.keyboard('{Enter}')
    await expect.element(modal).toBeVisible()
    if (kind === 'opening') await expect.element(editor).toHaveTextContent(source)
    else await expect.element(editor).toHaveValue(source)
    const savedPopup = modal.element()
    await editor.fill('Saved value')
    await modal.getByRole('button', { name: 'common.operation.save', exact: true }).click()
    await expect.element(modal).not.toBeInTheDocument()
    await expect.element(drawer).toBeVisible()
    expect(onChange).toHaveBeenCalledTimes(2)
    await expect.poll(() => savedPopup.isConnected).toBe(false)
    for (let index = 0; index < 12 && document.activeElement !== entry.element(); index++)
      await userEvent.tab()
    await userEvent.keyboard('{Enter}')
    await expect.element(modal).toBeVisible()
    if (kind === 'opening') await expect.element(editor).toHaveTextContent('Saved value')
    else await expect.element(editor).toHaveValue('Saved value')
  },
)

it.each([
  { entryName: 'common.operation.settings', title: 'appDebug.feature.moderation.modal.title' },
  {
    entryName: 'appDebug.openingStatement.writeOpener',
    title: 'appDebug.feature.conversationOpener.title',
  },
])('keeps $title footer reachable in a narrow short viewport', async ({ entryName, title }) => {
  await page.viewport(414, 640)
  await renderPanel()
  const entry = page.getByRole('button', { name: entryName, exact: true })
  for (let index = 0; index < 12 && document.activeElement !== entry.element(); index++)
    await userEvent.tab()
  await userEvent.keyboard('{Enter}')
  const modal = page.getByRole('dialog', {
    name: title,
    exact: true,
  })
  await expect.element(modal).toBeVisible()
  const popup = modal.element()
  const bounds = popup.getBoundingClientRect()
  expect(bounds.left).toBeGreaterThanOrEqual(0)
  expect(bounds.right).toBeLessThanOrEqual(innerWidth)
  const save = modal.getByRole('button', { name: 'common.operation.save', exact: true })
  await save.click()
  await expect.element(modal).not.toBeInTheDocument()
})

it('cancels first-time moderation configuration without enabling the feature', async () => {
  await renderPanel({ moderation: { enabled: false } })
  const toggle = page.getByRole('switch', { name: 'appDebug.feature.moderation.title' })
  await expect.element(toggle).not.toBeChecked()
  await toggle.click()
  const modal = page.getByRole('dialog', {
    name: 'appDebug.feature.moderation.modal.title',
    exact: true,
  })
  await expect.element(modal).toBeVisible()
  await userEvent.keyboard('{Escape}')
  await expect.element(page.getByRole('dialog', { name: 'workflow.common.features' })).toBeVisible()
  await expect.element(toggle).not.toBeChecked()
  expect(onChange).toHaveBeenCalledExactlyOnceWith()
})

it('requests the global provider settings route without submitting moderation', async () => {
  await renderPanel()
  const entry = page.getByRole('button', { name: 'common.operation.settings', exact: true })
  for (let index = 0; index < 12 && document.activeElement !== entry.element(); index++)
    await userEvent.tab()
  await userEvent.keyboard('{Enter}')
  const modal = page.getByRole('dialog', {
    name: 'appDebug.feature.moderation.modal.title',
    exact: true,
  })
  await modal
    .getByRole('button', { name: 'appDebug.feature.moderation.modal.provider.openai', exact: true })
    .click()
  await modal.getByRole('button', { name: 'navigation.settings.provider', exact: true }).click()
  await expect
    .poll(() => onUrlUpdate.mock.calls.at(-1)?.[0].searchParams.get('settings'))
    .toBe('provider')
  expect(onChange).not.toHaveBeenCalled()
  await expect.element(modal).toBeVisible()
})
