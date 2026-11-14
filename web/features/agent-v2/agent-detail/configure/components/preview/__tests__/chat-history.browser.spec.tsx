import { renderChatOwner } from '@/app/components/base/chat/chat/__tests__/chat-owner-preset'
import { AgentRosterResponseContent } from '@/app/components/base/chat/chat/answer/agent-roster-response-content'
import { guardUnexpectedFetch } from '@/test/unexpected-fetch'
import { getFormattedAgentDebugChatTree } from '../chat-history'
import { createAgentFileHistoryMessage } from './chat-history-fixtures'

vi.unmock('react-i18next')
// boundary: file previews read Next route params without a running application.
vi.mock('@/next/navigation', () => ({ useParams: () => ({}), usePathname: () => '/chat' }))

it('shows an operable report attachment when historical Agent tool activity is expanded', async () => {
  onTestFinished(guardUnexpectedFetch())
  const downloads: { name: string; url: string }[] = []
  // boundary: prevent external navigation while observing the real download anchor.
  const captureDownload = (event: MouseEvent) => {
    if (event.target instanceof HTMLAnchorElement && event.target.download) {
      event.preventDefault()
      downloads.push({ name: event.target.download, url: event.target.href })
    }
  }
  document.addEventListener('click', captureDownload, true)
  onTestFinished(() => document.removeEventListener('click', captureDownload, true))
  const answer = getFormattedAgentDebugChatTree([createAgentFileHistoryMessage()])[0]?.children?.[0]
  if (!answer) throw new Error('Expected a historical Agent answer')
  const screen = await renderChatOwner(<AgentRosterResponseContent item={answer} />)

  await screen.getByRole('button', { name: 'Thinking', exact: true }).click()
  const report = screen.getByRole('button', { name: 'report.pdf', exact: true })
  await expect.element(report).toBeVisible()
  await report.hover()
  await screen.getByRole('button', { name: 'Download', exact: true }).click()
  expect(downloads).toEqual([
    { name: 'report.pdf', url: 'https://files.test/report.pdf?sign=report&as_attachment=true' },
  ])
})
