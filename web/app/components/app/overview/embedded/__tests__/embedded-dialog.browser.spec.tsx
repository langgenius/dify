import { Dialog, DialogTrigger } from '@langgenius/dify-ui/dialog'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { render } from 'vitest-browser-react'
import { InputVarType } from '@/app/components/workflow/types'
import { seedAccountProfileQuery } from '@/test/console/account-profile'
import { EmbeddedDialogContent } from '../index'

vi.mock('copy-to-clipboard', () => ({ default: vi.fn() }))
vi.mock('@/service/base', () => ({
  get: vi.fn(),
  post: vi.fn(),
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

const prefix = 'appOverview.overview.appInfo.embedded'
const triggerLabel = 'deployments.studio.accessPoint.embedIntoSite'
const hiddenInputs = [
  {
    variable: 'secret',
    label: 'Secret',
    type: InputVarType.textInput,
    hide: true,
    required: true,
    default: 'initial value',
  },
]

function createClient() {
  return new QueryClient({ defaultOptions: { queries: { staleTime: Infinity, retry: false } } })
}

function dialogView(queryClient: QueryClient) {
  return (
    <QueryClientProvider client={queryClient}>
      <Dialog>
        <DialogTrigger>{triggerLabel}</DialogTrigger>
        <EmbeddedDialogContent
          accessToken="embed-token"
          appBaseUrl="https://app.example.com"
          hiddenInputs={hiddenInputs}
        />
      </Dialog>
    </QueryClientProvider>
  )
}

beforeEach(() => {
  vi.clearAllMocks()
})

afterEach(() => vi.unstubAllGlobals())

it('preserves the hidden input, selected tab and copied preview through the exit animation', async () => {
  vi.stubGlobal('BASE_UI_ANIMATIONS_DISABLED', false)
  const queryClient = createClient()
  seedAccountProfileQuery(queryClient)
  const screen = await render(dialogView(queryClient))
  const trigger = screen.getByRole('button', { name: triggerLabel })
  await trigger.click()
  const dialog = screen.getByRole('dialog', { name: `${prefix}.title` })
  const disclosure = dialog.getByRole('button', {
    name: new RegExp(`${prefix}.hiddenInputs.title`),
  })
  await expect.element(disclosure).toHaveAttribute('aria-expanded', 'false')
  await disclosure.click()
  const input = dialog.getByRole('textbox', { name: 'Secret' })
  await input.fill('draft secret')
  const scriptsTab = dialog.getByRole('tab', { name: `${prefix}.scripts` })
  await scriptsTab.click()
  const panel = dialog.getByRole('tabpanel', { name: `${prefix}.scripts` })
  await expect.poll(() => panel.element().textContent).toContain('draft secret')
  await panel.getByRole('button', { name: `${prefix}.copy`, exact: true }).click()
  const copied = panel.getByRole('button', { name: `${prefix}.copied`, exact: true })
  await expect.element(copied).toBeVisible()

  const popup = dialog.element()
  const draftInput = input.element() as HTMLInputElement
  const activeTab = scriptsTab.element()
  const preview = panel.element()
  const copyButton = copied.element()
  await expect.poll(() => getComputedStyle(popup).opacity).toBe('1')
  const exitFrame = new Promise<{
    draft: string
    selected: string | null
    preview: string | null
    copied: string | null
    opacity: number
  }>((resolve) => {
    const onTransition = (event: Event) => {
      if (event.target !== popup || (event as TransitionEvent).propertyName !== 'opacity') return
      popup.removeEventListener('transitionrun', onTransition)
      resolve({
        draft: draftInput.value,
        selected: activeTab.getAttribute('aria-selected'),
        preview: preview.textContent,
        copied: copyButton.getAttribute('aria-label'),
        opacity: Number(getComputedStyle(popup).opacity),
      })
    }
    popup.addEventListener('transitionrun', onTransition)
  })
  await dialog.getByRole('button', { name: 'common.operation.close' }).click()
  const closing = await exitFrame
  expect(closing.opacity).toBeGreaterThan(0)
  expect(closing.draft).toBe('draft secret')
  expect(closing.selected).toBe('true')
  expect(closing.preview).toContain('draft secret')
  expect(closing.copied).toBe(`${prefix}.copied`)
  await expect.element(dialog).not.toBeInTheDocument()
})
