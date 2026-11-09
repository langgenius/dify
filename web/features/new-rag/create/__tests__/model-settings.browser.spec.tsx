import { page } from 'vite-plus/test/browser'
import { render } from 'vitest-browser-react'
import { consoleQuery } from '@/service/console'
import {
  createCatalogModelFixture,
  createDefaultModelFixture,
  createModelCatalogFixture,
  seedModelProviderQueries,
} from '@/test/console/model-provider'
import { createConsoleQueryWrapper } from '@/test/console/query-data'
import { QueryTestingAdapter } from '@/test/query-state-testing-adapter'
import { CreateKnowledgePage } from '../page'

vi.mock('@/next/navigation', () => ({
  useRouter: () => ({ replace: vi.fn() }),
  useSearchParams: () => new URLSearchParams(),
}))

vi.mock('react-i18next', async () => {
  const actual = await vi.importActual<typeof import('react-i18next')>('react-i18next')
  const { createReactI18nextMock } = await import('@/test/i18n-mock')
  const { default: creation } = await import('@/i18n/locales/en-US/knowledge-create.json')
  const { default: space } = await import('@/i18n/locales/en-US/knowledge-space.json')
  const { default: settings } = await import('@/i18n/locales/en-US/knowledge-settings.json')
  const { default: provider } = await import('@/i18n/locales/en-US/model-provider.json')
  const { default: common } = await import('@/i18n/locales/en-US/common.json')
  return {
    ...actual,
    ...createReactI18nextMock(
      Object.fromEntries(
        Object.entries({
          knowledgeCreate: creation,
          knowledgeSpace: space,
          knowledgeSettings: settings,
          modelProvider: provider,
          common,
        }).flatMap(([namespace, translations]) =>
          Object.entries(translations).map(([key, value]) => [`${namespace}.${key}`, value]),
        ),
      ),
    ),
  }
})

it('keeps model menus usable inside the scrolling creation form on a small viewport', async () => {
  // Real layout and hit testing cover the scrolling form, fixed footer, and portalled menu.
  await page.viewport(640, 600)
  const { queryClient, wrapper: QueryProvider } = createConsoleQueryWrapper({
    systemFeatures: {
      deployment_edition: 'ENTERPRISE',
      enable_marketplace: false,
      rbac_enabled: false,
    },
    knowledgeFsFeatures: { upload_enabled: true },
  })
  const provider = 'langgenius/openai/openai'
  const definitions = [
    {
      model_type: 'llm',
      model: 'gpt-4.1-mini',
      label: 'GPT-4.1 mini',
      field: 'System reasoning model',
    },
    {
      model_type: 'text-embedding',
      model: 'text-embedding-3-small',
      label: 'Text Embedding 3 Small',
      field: 'Embedding model',
    },
    { model_type: 'rerank', model: 'rerank-v3', label: 'Rerank v3', field: 'Rerank Model' },
  ] as const
  seedModelProviderQueries(queryClient, [
    createModelCatalogFixture({
      provider,
      models: definitions.flatMap(({ model_type, model, label }) => [
        createCatalogModelFixture({ model_type, model, label: { en_US: label } }),
        createCatalogModelFixture({
          model_type,
          model: `${model}-custom`,
          label: { en_US: `${label} custom` },
        }),
      ]),
    }),
  ])
  for (const { model_type, model } of definitions) {
    queryClient.setQueryData(
      consoleQuery.workspaces.current.defaultModel.get.queryKey({
        input: { query: { model_type } },
      }),
      {
        data: createDefaultModelFixture({ model_type, model, provider: { provider } }),
      },
    )
  }
  queryClient.setQueryData(consoleQuery.workspaces.current.members.get.queryKey({ input: {} }), {
    accounts: [],
  })
  const screen = await render(
    <QueryProvider>
      <QueryTestingAdapter>
        <CreateKnowledgePage />
      </QueryTestingAdapter>
    </QueryProvider>,
  )
  const settings = screen.getByRole('button', { name: 'Model settings', exact: true })
  const submit = screen.getByRole('button', { name: 'Create Agent Knowledge Base', exact: true })
  const footerTop = submit.element().getBoundingClientRect().top
  await expect.element(settings).toHaveAttribute('aria-expanded', 'false')
  await settings.click()
  await expect.element(settings).toHaveAttribute('aria-expanded', 'true')

  for (const { field, label } of definitions) {
    const selector = screen.getByRole('button', { name: new RegExp(`^${field} `) })
    await selector.click()
    await page.getByRole('button', { name: `${label} custom`, exact: true }).click()
    await expect.element(selector.getByText(`${label} custom`, { exact: true })).toBeVisible()
    expect(submit.element().getBoundingClientRect().top).toBe(footerTop)
  }
  await settings.click()
  await expect.element(settings).toHaveAttribute('aria-expanded', 'false')
  expect(submit.element().getBoundingClientRect().top).toBe(footerTop)
})
