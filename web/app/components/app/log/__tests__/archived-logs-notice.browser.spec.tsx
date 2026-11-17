import { page, userEvent } from 'vite-plus/test/browser'
import { render } from 'vitest-browser-react'
import { createConsoleQueryWrapper } from '@/test/console/query-data'
import { createNuqsTestWrapper } from '@/test/nuqs-testing'
import { guardUnexpectedFetch } from '@/test/unexpected-fetch'
import { ArchivedLogsNotice } from '../archived-logs-notice'

async function renderNotice(plan: 'professional' | 'sandbox' = 'professional') {
  const { wrapper: ConsoleProvider } = createConsoleQueryWrapper({
    currentWorkspace: { role: 'admin' },
    systemFeatures: { deployment_edition: 'CLOUD' },
    features: { billing: { subscription: { plan } } },
  })
  const { wrapper: UrlState, onUrlUpdate } = createNuqsTestWrapper({ hasMemory: true })
  const screen = await render(
    <ConsoleProvider>
      <UrlState>
        <ArchivedLogsNotice />
      </UrlState>
    </ConsoleProvider>,
  )
  return { screen, onUrlUpdate }
}

beforeEach(() => onTestFinished(guardUnexpectedFetch()))

it('takes a paid workspace manager to archive settings from the keyboard', async () => {
  const { screen, onUrlUpdate } = await renderNotice()
  const notice = screen.getByRole('status')
  await expect.element(notice.getByText('appLog.archives.notice.description')).toBeVisible()
  const action = notice.getByRole('button', { name: 'appLog.archives.notice.action' })
  await userEvent.tab()
  await expect.element(action).toHaveFocus()
  await userEvent.keyboard('{Enter}')
  await expect
    .poll(() => onUrlUpdate.mock.lastCall?.[0].searchParams.get('settings'))
    .toBe('workflow-log-archives')
})

it('omits the paid archive-settings action in a sandbox workspace', async () => {
  await renderNotice('sandbox')
  await expect.element(page.getByRole('status')).not.toBeInTheDocument()
  await expect
    .element(page.getByRole('button', { name: 'appLog.archives.notice.action' }))
    .not.toBeInTheDocument()
})
