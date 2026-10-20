import { NuqsTestingAdapter } from 'nuqs/adapters/testing'
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
import GetAutomaticRes from '../get-automatic-res'

vi.mock('react-i18next', async () => {
  const { createReactI18nextMock } = await import('@/test/i18n-mock')
  const { default: appDebug } = await import('@/i18n/locales/en-US/app-debug.json')
  const { default: appGeneration } = await import('@/i18n/locales/en-US/app-generation.json')
  const { default: common } = await import('@/i18n/locales/en-US/common.json')
  return createReactI18nextMock({ ...appDebug, ...appGeneration, ...common })
})

vi.mock('@/service/debug', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/service/debug')>()),
  generateBasicAppFirstTimeRule: async () => ({
    prompt: 'Summarize the supplied meeting notes into actionable next steps for the team.',
    variables: [],
    opening_statement: '',
  }),
  generateRule: vi.fn(),
}))

const expectWithin = (element: Element, container: Element) => {
  const rect = element.getBoundingClientRect()
  const bounds = container.getBoundingClientRect()
  expect(rect.width).toBeGreaterThan(0)
  expect(rect.left).toBeGreaterThanOrEqual(bounds.left - 1)
  expect(rect.right).toBeLessThanOrEqual(bounds.right + 1)
}

describe('Prompt generator reflow', () => {
  beforeEach(() => {
    localStorage.clear()
    sessionStorage.clear()
  })

  it.each([320])(
    'keeps inputs and generated result actions within a %i CSS pixel viewport',
    async (width) => {
      // Unit tests cannot detect the original fixed 1140px popup being clipped.
      // Rendering the production dialog and Result proves both panels remain usable.
      await page.viewport(width, 900)
      const { queryClient, wrapper: QueryProvider } = createConsoleQueryWrapper()
      seedModelProviderQueries(queryClient, [
        createModelCatalogFixture({
          models: [
            createCatalogModelFixture({
              model: 'gpt-4.1-mini',
              label: { en_US: 'GPT-4.1 mini' },
              model_properties: { mode: 'chat' },
            }),
          ],
        }),
      ])
      queryClient.setQueryData(
        consoleQuery.workspaces.current.defaultModel.get.queryKey({
          input: { query: { model_type: 'llm' } },
        }),
        { data: createDefaultModelFixture({ model: 'gpt-4.1-mini' }) },
      )
      queryClient.setQueryDefaults(
        consoleQuery.workspaces.current.modelProviders.byProvider.models.parameterRules.get.key(),
        { initialData: { data: [] } },
      )
      const screen = await render(
        <NuqsTestingAdapter>
          <QueryProvider>
            <GetAutomaticRes
              modelMode="chat"
              isShow
              onClose={vi.fn()}
              onFinished={vi.fn()}
              flowId={`reflow-${width}`}
              isBasicMode
            />
          </QueryProvider>
        </NuqsTestingAdapter>,
      )

      const dialog = screen.getByRole('dialog', { name: 'Prompt Generator' })
      const instructions = screen.getByRole('textbox', { name: 'Instructions' })
      const generate = screen.getByRole('button', { name: 'Generate', exact: true })
      await expect.element(dialog).toBeVisible()
      await instructions.fill('Summarize meeting notes for the team.')
      await generate.click()

      const apply = screen.getByRole('button', { name: 'Apply', exact: true })
      const copy = screen.getByRole('button', { name: 'Copy', exact: true })
      const result = screen.getByText(
        'Summarize the supplied meeting notes into actionable next steps for the team.',
        { exact: true },
      )
      await expect.element(apply).toBeVisible()
      await expect.element(result).toBeVisible()

      const dialogElement = dialog.element()
      const bounds = dialogElement.getBoundingClientRect()
      expect(bounds.left).toBeGreaterThanOrEqual(0)
      expect(bounds.right).toBeLessThanOrEqual(width)
      expect(dialogElement.scrollWidth).toBeLessThanOrEqual(dialogElement.clientWidth + 1)
      const modelSelector = screen.getByRole('button', { name: /^GPT-4.1 mini/ })
      const modelSettings = screen.getByRole('button', { name: /modelProvider.modelSettings/ })
      await expect.element(modelSelector).toBeVisible()
      await expect.element(modelSettings).toBeVisible()
      for (const element of [
        instructions,
        generate,
        apply,
        copy,
        result,
        modelSelector,
        modelSettings,
      ])
        expectWithin(element.element(), dialogElement)

      const instructionsRect = instructions.element().getBoundingClientRect()
      const resultRect = result.element().getBoundingClientRect()
      expect(resultRect.top).toBeGreaterThan(instructionsRect.bottom)

      await apply.click()
      await expect.element(screen.getByRole('alertdialog')).toBeVisible()
      queryClient.clear()
    },
  )
})
