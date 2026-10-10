import { NuqsTestingAdapter } from 'nuqs/adapters/testing'
import { page, userEvent } from 'vite-plus/test/browser'
import { cleanup, render } from 'vitest-browser-react'
import AnnotationCtrlButton from '@/app/components/base/features/new-feature-panel/annotation-reply/annotation-ctrl-button'
import { ModalContextProvider } from '@/context/modal-context-provider'
import { createConsoleQueryWrapper } from '@/test/console/query-data'
import { QueryClientTestProvider } from '@/test/console/query-provider'

const clients: ReturnType<typeof createConsoleQueryWrapper>['queryClient'][] = []
const onAdded = vi.fn()
const onUrlUpdate = vi.fn()

async function renderQuotaEntry() {
  const { queryClient } = createConsoleQueryWrapper({
    systemFeatures: { deployment_edition: 'CLOUD' },
    features: { annotation_quota_limit: { size: 100, limit: 100 } },
  })
  clients.push(queryClient)
  await render(
    <QueryClientTestProvider queryClient={queryClient}>
      <NuqsTestingAdapter hasMemory onUrlUpdate={onUrlUpdate}>
        <ModalContextProvider>
          <AnnotationCtrlButton
            appId="app-quota"
            messageId="message-quota"
            cached={false}
            query="Question"
            answer="Answer"
            onAdded={onAdded}
            onEdit={vi.fn()}
          />
        </ModalContextProvider>
      </NuqsTestingAdapter>
    </QueryClientTestProvider>,
  )
  const entry = page.getByRole('button', { name: 'appDebug.feature.annotation.add', exact: true })
  await userEvent.tab()
  await expect.element(entry).toHaveFocus()
  await userEvent.keyboard('{Enter}')
  const modal = page.getByRole('dialog')
  await expect.element(modal).toBeVisible()
  return { entry, modal }
}

beforeEach(() => {
  onAdded.mockClear()
  onUrlUpdate.mockClear()
  ;(
    globalThis as typeof globalThis & { BASE_UI_ANIMATIONS_DISABLED: boolean }
  ).BASE_UI_ANIMATIONS_DISABLED = false
  vi.spyOn(globalThis, 'fetch').mockImplementation(async (input) => {
    throw new Error(`Unexpected request: ${input instanceof Request ? input.url : String(input)}`)
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

it('opens the quota notice from the real annotation command and retains usage through exit', async () => {
  const { entry, modal } = await renderQuotaEntry()
  await expect
    .element(modal)
    .toHaveAccessibleName(
      'billing.annotatedResponse.fullTipLine1 billing.annotatedResponse.fullTipLine2',
    )
  const usage = modal.getByRole('group', { name: 'billing.annotatedResponse.quotaTitle' })
  await expect.element(usage.getByRole('meter')).toHaveAttribute('aria-valuenow', '100')
  expect(onAdded).not.toHaveBeenCalled()
  expect(fetch).not.toHaveBeenCalled()
  const popup = modal.element()
  const usageElement = usage.element()
  const exitUsage: boolean[] = []
  popup.addEventListener('transitionrun', () => {
    if (popup.hasAttribute('data-ending-style'))
      exitUsage.push(usageElement.isConnected && popup.contains(usageElement))
  })
  await userEvent.keyboard('{Escape}')
  await expect.poll(() => exitUsage.length).toBeGreaterThan(0)
  expect(exitUsage.every(Boolean)).toBe(true)
  await expect.poll(() => popup.isConnected).toBe(false)
  await expect.element(entry).toHaveFocus()
  await userEvent.keyboard(' ')
  await expect.element(modal).toBeVisible()
  await expect
    .element(modal.getByRole('group', { name: 'billing.annotatedResponse.quotaTitle' }))
    .toBeVisible()
  const reopenedPopup = modal.element()
  await modal.getByRole('button', { name: 'common.operation.close', exact: true }).click()
  await expect.poll(() => reopenedPopup.isConnected).toBe(false)
  await expect.element(entry).toHaveFocus()
  expect(fetch).not.toHaveBeenCalled()
})

it('keeps Upgrade wired to the pricing URL without adding an annotation', async () => {
  const { modal } = await renderQuotaEntry()
  await modal.getByRole('button', { name: 'billing.upgradeBtn.encourage', exact: true }).click()
  await expect
    .poll(() => onUrlUpdate.mock.calls.at(-1)?.[0].searchParams.get('pricing'))
    .toBe('open')
  await expect.element(modal).toBeVisible()
  expect(onAdded).not.toHaveBeenCalled()
  expect(fetch).not.toHaveBeenCalled()
})
