import type {
  ModelProviderSummaryResponse,
  ProviderWithModelsResponse,
} from '@dify/contracts/api/console/workspaces/types.gen'
import type { DefaultModelResponse } from '../../declarations'
import { QueryClient } from '@tanstack/react-query'
import { NuqsTestingAdapter } from 'nuqs/adapters/testing'
import { page, userEvent } from 'vite-plus/test/browser'
import { cleanup, render } from 'vitest-browser-react'
import { seedAccountProfileQuery } from '@/test/console/account-profile'
import { seedSystemFeatures } from '@/test/console/query-data'
import { QueryClientTestProvider } from '@/test/console/query-provider'
import { seedWorkspacePermissionsQuery } from '@/test/console/workspace-permissions'
import { ModelTypeEnum } from '../../declarations'
import SystemModel from '../index'

const { request } = vi.hoisted(() => ({ request: vi.fn() }))
vi.mock('@/service/base', () => ({
  request,
  get: vi.fn(),
  post: vi.fn(),
  put: vi.fn(),
  patch: vi.fn(),
  del: vi.fn(),
  getPublic: vi.fn(),
  getMarketplace: vi.fn(),
  postPublic: vi.fn(),
  postMarketplace: vi.fn(),
  delPublic: vi.fn(),
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
const modelProvider: ProviderWithModelsResponse = {
  tenant_id: 'test-workspace',
  provider: 'openai',
  icon_small: { en_US: '', zh_Hans: '' },
  label: { en_US: 'OpenAI', zh_Hans: 'OpenAI' },
  status: 'active',
  models: [
    {
      model: 'gpt-4',
      label: { en_US: 'GPT-4', zh_Hans: 'GPT-4' },
      model_type: 'llm',
      fetch_from: 'predefined-model',
      status: 'active',
      model_properties: {},
      load_balancing_enabled: false,
    },
  ],
}
const providerSummary: ModelProviderSummaryResponse = {
  provider: 'openai',
  plugin_id: 'langgenius/openai',
  label: { en_US: 'OpenAI', zh_Hans: 'OpenAI' },
  supported_model_types: ['llm'],
  configurate_methods: ['predefined-model'],
  preferred_provider_type: 'custom',
  is_configured: true,
  custom_configuration: {
    status: 'active',
    has_custom_models: false,
    available_credentials: [],
    current_credential_usable: true,
  },
  system_configuration: { enabled: false },
}
const savedModel: DefaultModelResponse = {
  model: 'gpt-4',
  model_type: ModelTypeEnum.textGeneration,
  provider: { provider: 'openai', icon_small: { en_US: '', zh_Hans: '' } },
}
const clients: QueryClient[] = []
async function setup(searchParams = '') {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false, staleTime: Infinity } },
  })
  clients.push(client)
  seedAccountProfileQuery(client, { interface_language: 'en-US' })
  seedSystemFeatures(client, { deployment_edition: 'COMMUNITY' })
  seedWorkspacePermissionsQuery(client, ['plugin.model_config'])
  request.mockImplementation(
    async (_url: string, _init: RequestInit, options: { request: Request }) => {
      const req = options.request
      const path = new URL(req.url).pathname
      if (req.method !== 'GET') throw new Error(`Unexpected mutation: ${req.method} ${path}`)
      if (path.endsWith('/model-providers/summary'))
        return Response.json({ data: [providerSummary], plugins: {} })
      if (path.endsWith('/model-providers/credits'))
        return Response.json({ remaining_credits: 0, is_unlimited: false, is_exhausted: true })
      if (path.includes('/models/model-types/'))
        return Response.json({ data: path.endsWith('/llm') ? [modelProvider] : [] })
      throw new Error(`Unexpected GET: ${path}`)
    },
  )
  const onUrlUpdate = vi.fn()
  const screen = await render(
    <NuqsTestingAdapter searchParams={searchParams} onUrlUpdate={onUrlUpdate}>
      <QueryClientTestProvider queryClient={client}>
        <SystemModel
          textGenerationDefaultModel={savedModel}
          embeddingsDefaultModel={undefined}
          rerankDefaultModel={undefined}
          speech2textDefaultModel={undefined}
          ttsDefaultModel={undefined}
          notConfigured={false}
        />
      </QueryClientTestProvider>
    </NuqsTestingAdapter>,
  )
  return { screen, onUrlUpdate }
}
async function settle(element: Element) {
  await expect
    .poll(
      () =>
        !element.hasAttribute('data-starting-style') &&
        element.getAnimations().every((animation) => animation.playState === 'finished'),
    )
    .toBe(true)
}
beforeEach(() => {
  vi.clearAllMocks()
  vi.stubGlobal('BASE_UI_ANIMATIONS_DISABLED', false)
})
afterEach(async () => {
  await cleanup()
  clients.splice(0).forEach((client) => client.clear())
  vi.unstubAllGlobals()
})
it('keeps the system-model dialog and actions inside a narrow viewport', async () => {
  await page.viewport(414, 800)
  const { screen } = await setup()
  const entry = screen.getByRole('button', { name: /systemModelSettings$/ })
  await entry.click()
  const dialog = screen.getByRole('dialog', { name: /systemModelSettingsTitle$/ })
  const save = dialog.getByRole('button', { name: 'common.operation.save' })
  await expect.element(save).toBeEnabled()
  await settle(dialog.element())
  const rect = dialog.element().getBoundingClientRect()
  expect(rect.left).toBeGreaterThanOrEqual(0)
  expect(rect.right).toBeLessThanOrEqual(window.innerWidth)
  for (const button of [
    save,
    dialog.getByRole('button', { name: 'common.operation.close' }),
    dialog.getByRole('button', { name: 'common.operation.cancel' }),
  ]) {
    const bounds = button.element().getBoundingClientRect()
    expect(bounds.left).toBeGreaterThanOrEqual(0)
    expect(bounds.right).toBeLessThanOrEqual(window.innerWidth)
    expect(bounds.bottom).toBeLessThanOrEqual(window.innerHeight)
  }
  await expect
    .element(dialog)
    .toHaveAccessibleDescription('modelProvider.modelProvider.systemModelSettingsDesc')
  await dialog.getByRole('button', { name: 'common.operation.cancel' }).click()
  await expect.element(entry).toHaveFocus()
  await page.viewport(1100, 800)
  await entry.click()
  await settle(dialog.element())
  expect(dialog.element().getBoundingClientRect().width).toBe(480)
})
it('cancels a real model reset, preserves unrelated URL state and restores the saved selection', async () => {
  await page.viewport(1100, 800)
  const { screen, onUrlUpdate } = await setup('?dialog=system-models&source=goto-anything')
  const dialog = screen.getByRole('dialog', { name: /systemModelSettingsTitle$/ })
  const model = dialog.getByRole('button', { name: /GPT-4/ })
  await expect.element(model).toBeVisible()
  await model.hover()
  await dialog.getByRole('button', { name: /operation.reset.*systemReasoningModel.key/ }).click()
  await expect.element(model).not.toBeInTheDocument()
  const element = dialog.element()
  await dialog.getByRole('button', { name: 'common.operation.cancel' }).click()
  await expect.poll(() => element.isConnected).toBe(false)
  expect(onUrlUpdate).toHaveBeenCalledWith(
    expect.objectContaining({ queryString: '?source=goto-anything' }),
  )
  const entry = screen.getByRole('button', { name: /systemModelSettings$/ })
  await entry.click()
  await expect.element(model).toBeVisible()
  await userEvent.keyboard('{Escape}')
  await expect.element(entry).toHaveFocus()
})
