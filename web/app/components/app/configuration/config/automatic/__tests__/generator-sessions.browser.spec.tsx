import type { GenRes } from '@/service/debug'
import { NuqsTestingAdapter } from 'nuqs/adapters/testing'
import { ReactFlowProvider } from 'reactflow'
import { page, userEvent } from 'vite-plus/test/browser'
import { cleanup, render } from 'vitest-browser-react'
import { ModelTypeEnum } from '@/app/components/header/account-setting/model-provider-page/declarations'
import { WorkflowContextProvider } from '@/app/components/workflow/context'
import { HooksStoreContextProvider } from '@/app/components/workflow/hooks-store'
import CodeGenerateBtn from '@/app/components/workflow/nodes/_base/components/code-generator-button'
import { CodeLanguage } from '@/app/components/workflow/nodes/code/types'
import PromptGeneratorBtn from '@/app/components/workflow/nodes/llm/components/prompt-generator-btn'
import { EventEmitterContextProvider } from '@/context/event-emitter-provider'
import { consoleQuery } from '@/service/console'
import { commonQueryKeys } from '@/service/use-common'
import { createConsoleQueryWrapper } from '@/test/console/query-data'
import { QueryClientTestProvider } from '@/test/console/query-provider'
import { FlowType } from '@/types/common'

const { get, post } = vi.hoisted(() => ({ get: vi.fn(), post: vi.fn() }))
vi.mock('react-i18next', async () => {
  const { createReactI18nextMock } = await import('@/test/i18n-mock')
  const { default: appDebug } = await import('@/i18n/locales/en-US/app-debug.json')
  const { default: appGeneration } = await import('@/i18n/locales/en-US/app-generation.json')
  const { default: common } = await import('@/i18n/locales/en-US/common.json')
  return createReactI18nextMock({ ...appDebug, ...appGeneration, ...common })
})
vi.mock('@/service/base', () => ({
  get,
  post,
  request: vi.fn(),
  getPublic: vi.fn(),
  getMarketplace: vi.fn(),
  postPublic: vi.fn(),
  postMarketplace: vi.fn(),
  put: vi.fn(),
  del: vi.fn(),
  delPublic: vi.fn(),
  patch: vi.fn(),
  patchPublic: vi.fn(),
  upload: vi.fn(),
  ssePost: vi.fn(),
  sseGet: vi.fn(),
  sseGeneratorPost: vi.fn(),
  handleStream: vi.fn(),
  buildSigninUrlWithRedirect: vi.fn(),
  isWebAppSigninPath: vi.fn(),
  buildWebAppSigninUrlWithRedirect: vi.fn(),
}))

// Model selection and Monaco decoding are independent of generator session ownership.
// Keep the real instruction editor, Result, version menu and overwrite confirmation.
vi.mock(
  '@/app/components/header/account-setting/model-provider-page/model-parameter-modal',
  () => ({
    default: () => <button type="button">Test model</button>,
  }),
)
vi.mock('@monaco-editor/react', () => {
  function Editor({ value, options }: { value?: string; options?: { readOnly?: boolean } }) {
    return <textarea aria-label="Generated code" value={value} readOnly={options?.readOnly} />
  }
  return {
    Editor,
    default: Editor,
    DiffEditor: Editor,
    useMonaco: () => null,
    loader: { config: vi.fn() },
  }
})
const clients: ReturnType<typeof createConsoleQueryWrapper>['queryClient'][] = []
const onGenerated = vi.fn()
const firstResult: GenRes = { modified: 'First generated result', message: '' }
const secondResult: GenRes = { modified: 'Second generated result', message: '' }

async function renderEntry(kind: 'prompt' | 'code') {
  const { queryClient } = createConsoleQueryWrapper()
  clients.push(queryClient)
  queryClient.setQueryData(commonQueryKeys.defaultModel(ModelTypeEnum.textGeneration), {
    data: { model: 'test-model', provider: { provider: 'test-provider' } },
  })
  queryClient.setQueryData(
    consoleQuery.workspaces.current.models.modelTypes.byModelType.get.queryKey({
      input: { params: { model_type: ModelTypeEnum.textGeneration } },
    }),
    { data: [] },
  )
  queryClient.setQueryData(
    consoleQuery.instructionGenerate.template.post.queryKey({
      input: { body: { type: kind } },
    }),
    { data: 'Explain the desired result.' },
  )
  return render(
    <QueryClientTestProvider queryClient={queryClient}>
      <NuqsTestingAdapter>
        <WorkflowContextProvider>
          <ReactFlowProvider>
            <HooksStoreContextProvider
              configsMap={{
                flowId: 'generator-flow',
                flowType: FlowType.appFlow,
                fileSettings: {},
              }}
            >
              <EventEmitterContextProvider>
                {kind === 'prompt' ? (
                  <PromptGeneratorBtn
                    nodeId="prompt-node"
                    currentPrompt="Original prompt"
                    onGenerated={onGenerated}
                  />
                ) : (
                  <CodeGenerateBtn
                    nodeId="code-node"
                    currentCode="return old_value"
                    codeLanguages={CodeLanguage.python3}
                    onGenerated={onGenerated}
                  />
                )}
              </EventEmitterContextProvider>
            </HooksStoreContextProvider>
          </ReactFlowProvider>
        </WorkflowContextProvider>
      </NuqsTestingAdapter>
    </QueryClientTestProvider>,
  )
}
beforeEach(() => {
  localStorage.clear()
  sessionStorage.clear()
  vi.stubGlobal('BASE_UI_ANIMATIONS_DISABLED', false)
  vi.clearAllMocks()
  get.mockImplementation(async (path: string) => {
    if (path === '/spec/schema-definitions' || path.startsWith('/workspaces/current/tools/'))
      return []
    throw new Error(`Unexpected GET: ${path}`)
  })
  post.mockResolvedValue(firstResult)
})
afterEach(async () => {
  await cleanup()
  clients.splice(0).forEach((client) => client.clear())
  vi.unstubAllGlobals()
  await page.viewport(1280, 900)
})

it.each(['prompt', 'code'] as const)(
  'restores the %s entry, persisted instructions and selected version while discarding temporary ideal output',
  async (kind) => {
    const width = kind === 'code' ? 414 : 1280
    await page.viewport(width, 900)
    const screen = await renderEntry(kind)
    const entry = screen.getByRole('button', { name: 'Generate', exact: true })
    await entry.click()
    const dialog = screen.getByRole('dialog', {
      name: kind === 'code' ? 'Code Generator' : 'Prompt Generator',
      exact: true,
    })
    await expect.element(dialog).toBeVisible()
    const instructions = dialog.getByRole('textbox', { name: 'Instructions', exact: true })
    const dismiss = dialog.getByRole('button', { name: 'Dismiss', exact: true })
    await instructions.fill('Persist these instructions')
    post.mockResolvedValueOnce(firstResult).mockResolvedValueOnce(secondResult)
    const generate = dialog.getByRole('button', {
      name: 'Generate',
      exact: true,
    })
    await generate.click()
    const apply = dialog.getByRole('button', { name: 'Apply', exact: true })
    await expect.element(apply).toBeVisible()
    await expect.poll(() => getComputedStyle(dialog.element()).opacity).toBe('1')
    const bounds = dialog.element().getBoundingClientRect()
    if (kind === 'code') {
      const actionBounds = apply.element().getBoundingClientRect()
      expect(bounds.left).toBeGreaterThanOrEqual(0)
      expect(bounds.right).toBeLessThanOrEqual(width)
      expect(actionBounds.left).toBeGreaterThanOrEqual(0)
      expect(actionBounds.right).toBeLessThanOrEqual(width)
    }
    await generate.click()
    await dialog.getByRole('button', { name: /Version 2/ }).click()
    await screen.getByRole('menuitemradio', { name: 'Version 1', exact: true }).click()
    await dialog.getByRole('button', { name: /Ideal Output/ }).click()
    const ideal = dialog.getByRole('textbox', { name: 'Ideal Output', exact: true })
    await ideal.fill('Temporary ideal output')
    const popup = dialog.element()
    const idealElement = ideal.element() as HTMLTextAreaElement
    await expect.poll(() => getComputedStyle(popup).opacity).toBe('1')
    const exitDraft = new Promise<boolean>((resolve) => {
      const observe = (event: Event) => {
        if (event.target !== popup || (event as TransitionEvent).propertyName !== 'opacity') return
        popup.removeEventListener('transitionrun', observe)
        resolve(popup.isConnected && idealElement.value === 'Temporary ideal output')
      }
      popup.addEventListener('transitionrun', observe)
    })
    await dismiss.click()
    expect(await exitDraft).toBe(true)
    await expect.element(dialog).not.toBeInTheDocument()
    await expect.element(entry).toHaveFocus()
    await userEvent.keyboard('{Enter}')
    await expect.element(instructions).toHaveTextContent('Persist these instructions')
    await expect.element(dialog.getByRole('button', { name: /Version 1/ })).toBeVisible()
    if (kind === 'code')
      await expect
        .element(dialog.getByRole('textbox', { name: 'Generated code' }))
        .toHaveValue(firstResult.modified)
    else await expect.element(dialog.getByText(firstResult.modified, { exact: true })).toBeVisible()
    await dialog.getByRole('button', { name: /Ideal Output/ }).click()
    await expect.element(ideal).toHaveValue('')
    await apply.click()
    const confirmation = screen.getByRole('alertdialog')
    await expect.element(confirmation).toBeVisible()
    await userEvent.keyboard('{Escape}')
    await expect.element(confirmation).not.toBeInTheDocument()
    await expect.element(dialog).toBeVisible()
    await expect.element(apply).toHaveFocus()
    expect(onGenerated).not.toHaveBeenCalled()
    await apply.click()
    await confirmation.getByRole('button', { name: 'Confirm', exact: true }).click()
    await expect.element(dialog).not.toBeInTheDocument()
    await expect.element(entry).toHaveFocus()
    expect(onGenerated).toHaveBeenCalledExactlyOnceWith(firstResult.modified)
  },
)

it('allows closing the code generator while generation is pending without applying a late result', async () => {
  await page.viewport(1280, 900)
  let finish!: (result: GenRes) => void
  post.mockImplementation(
    () =>
      new Promise<GenRes>((resolve) => {
        finish = resolve
      }),
  )
  const screen = await renderEntry('code')
  const entry = screen.getByRole('button', { name: 'Generate', exact: true })
  await entry.click()
  const dialog = screen.getByRole('dialog', { name: 'Code Generator', exact: true })
  await dialog.getByRole('textbox', { name: 'Instructions', exact: true }).fill('Generate later')
  await dialog.getByRole('button', { name: 'Generate', exact: true }).click()
  await expect.poll(() => post.mock.calls.length).toBe(1)
  await userEvent.keyboard('{Escape}')
  await expect.element(dialog).not.toBeInTheDocument()
  await expect.element(entry).toHaveFocus()
  finish(firstResult)
  await userEvent.keyboard('{Enter}')
  await expect
    .element(dialog.getByRole('textbox', { name: 'Generated code' }))
    .toHaveValue(firstResult.modified)
  expect(onGenerated).not.toHaveBeenCalled()
  await dialog.getByRole('button', { name: 'Dismiss', exact: true }).click()
  await expect.element(dialog).not.toBeInTheDocument()
  await expect.element(entry).toHaveFocus()
})
