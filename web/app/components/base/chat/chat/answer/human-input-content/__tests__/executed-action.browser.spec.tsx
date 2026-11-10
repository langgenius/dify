import { Suspense } from 'react'
import { page } from 'vite-plus/test/browser'
import { render } from 'vitest-browser-react'
import { I18nClientProvider } from '@/app/components/provider/i18n'
import { changeLanguage } from '@/i18n/client'
import ExecutedAction from '../executed-action'

vi.unmock('react-i18next')
const loadResource = vi.hoisted(() => vi.fn())
vi.mock('@/i18n/load-resource', () => ({ loadI18nResource: loadResource }))

it('loads the action namespace and replaces the visible completion copy when the locale changes', async () => {
  const { loadI18nResource } =
    await vi.importActual<typeof import('@/i18n/load-resource')>('@/i18n/load-resource')
  loadResource.mockImplementation(loadI18nResource)
  onTestFinished(async () => changeLanguage('en-US'))

  await render(
    <I18nClientProvider locale="en-US" resource={{}}>
      <Suspense fallback={<span>Loading action</span>}>
        <ExecutedAction executedAction={{ id: 'Approve', title: 'Approve' }} />
      </Suspense>
    </I18nClientProvider>,
  )

  await expect.element(page.getByText(/Approve has been triggered/)).toBeVisible()
  expect(loadResource).toHaveBeenCalledWith('en-US', 'workflowHumanInput')
  await expect
    .element(page.getByText('nodes.humanInput.userActions.triggered'))
    .not.toBeInTheDocument()

  await changeLanguage('zh-Hans')

  await expect.element(page.getByText(/已触发Approve/)).toBeVisible()
  expect(loadResource).toHaveBeenCalledWith('zh-Hans', 'workflowHumanInput')
})
