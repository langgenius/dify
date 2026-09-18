import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { page } from 'vite-plus/test/browser'
import { render } from 'vitest-browser-react'
import { AppModeEnum } from '@/types/app'
import GetAutomaticRes from '../get-automatic-res'

vi.mock('react-i18next', async () => {
  const { createReactI18nextMock } = await import('@/test/i18n-mock')
  const { default: appDebug } = await import('@/i18n/locales/en-US/app-debug.json')
  const { default: common } = await import('@/i18n/locales/en-US/common.json')
  return createReactI18nextMock({ ...appDebug, ...common })
})

vi.mock(
  '@/app/components/header/account-setting/model-provider-page/hooks',
  async (importOriginal) => ({
    ...(await importOriginal<
      typeof import('@/app/components/header/account-setting/model-provider-page/hooks')
    >()),
    useModelListAndDefaultModelAndCurrentProviderAndModel: () => ({
      defaultModel: { model: 'gpt-4.1-mini', provider: { provider: 'openai' } },
    }),
  }),
)

// The independent model picker is outside this regression; the real generator,
// Lexical editors, result actions, and overlay remain the layout owners under test.
vi.mock(
  '@/app/components/header/account-setting/model-provider-page/model-parameter-modal',
  () => ({
    default: () => <button type="button">gpt-4.1-mini</button>,
  }),
)

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

  afterEach(async () => {
    await page.viewport(1280, 720)
  })

  it.each([320, 720, 1440])(
    'keeps inputs and generated result actions within a %i CSS pixel viewport',
    async (width) => {
      // Unit tests cannot detect the original fixed 1140px popup being clipped.
      // Rendering the production dialog and Result proves both panels remain usable.
      await page.viewport(width, 900)
      const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
      const screen = await render(
        <QueryClientProvider client={queryClient}>
          <GetAutomaticRes
            mode={AppModeEnum.CHAT}
            isShow
            onClose={vi.fn()}
            onFinished={vi.fn()}
            flowId={`reflow-${width}`}
            isBasicMode
          />
        </QueryClientProvider>,
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
      for (const element of [instructions, generate, apply, copy, result])
        expectWithin(element.element(), dialogElement)

      const instructionsRect = instructions.element().getBoundingClientRect()
      const resultRect = result.element().getBoundingClientRect()
      if (width < 1280) expect(resultRect.top).toBeGreaterThan(instructionsRect.bottom)
      else expect(resultRect.left).toBeGreaterThan(instructionsRect.right)

      await apply.click()
      await expect.element(screen.getByRole('alertdialog')).toBeVisible()
      queryClient.clear()
    },
  )
})
