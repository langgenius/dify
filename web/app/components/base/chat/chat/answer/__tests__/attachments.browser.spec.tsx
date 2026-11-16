import { page } from 'vite-plus/test/browser'
import { createChatFileFixture } from '@/test/fixtures/chat'
import { guardUnexpectedFetch } from '@/test/unexpected-fetch'
import { chatItem, renderChatOwner } from '../../__tests__/chat-owner-preset'
import Answer from '../index'

vi.unmock('react-i18next')
// boundary: real file owners consume Next params without a running application.
vi.mock('@/next/navigation', () => ({ useParams: () => ({}), usePathname: () => '/chat' }))

it('downloads the displayed generated and message files with their actual names and destinations', async () => {
  await page.viewport(1000, 800)
  onTestFinished(guardUnexpectedFetch())
  const downloads: { name: string; url: string }[] = []
  // boundary: prevent external navigation while observing the real activated download anchors.
  const captureDownload = (event: MouseEvent) => {
    if (event.target instanceof HTMLAnchorElement && event.target.download) {
      event.preventDefault()
      downloads.push({ name: event.target.download, url: event.target.href })
    }
  }
  document.addEventListener('click', captureDownload, true)
  onTestFinished(() => document.removeEventListener('click', captureDownload, true))
  const file = createChatFileFixture({
    id: 'generated',
    name: 'generated.pdf',
    type: 'application/pdf',
    url: 'https://example.com/generated.pdf',
  })
  await renderChatOwner(
    <Answer
      item={chatItem({
        allFiles: [file],
        message_files: [
          { ...file, id: 'message', name: 'message.pdf', url: 'https://example.com/message.pdf' },
        ],
      })}
      question="Question"
      index={0}
    />,
  )
  for (const name of ['generated.pdf', 'message.pdf']) {
    const row = page.getByRole('button', { name, exact: true })
    await row.hover()
    await page.getByRole('button', { name: 'Download', exact: true }).click()
  }
  expect(downloads).toEqual([
    { name: 'generated.pdf', url: 'https://example.com/generated.pdf?as_attachment=true' },
    { name: 'message.pdf', url: 'https://example.com/message.pdf?as_attachment=true' },
  ])
})
