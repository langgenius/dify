import type { ChatItem } from '../../types'
import { useState } from 'react'
import { page } from 'vite-plus/test/browser'
import { guardUnexpectedFetch } from '@/test/unexpected-fetch'
import { pendingForm } from '../answer/__tests__/answer-form-preset'
import Chat from '../index'
import { chatItem, renderChatOwner } from './chat-owner-preset'

vi.unmock('react-i18next')
// boundary: Chat reads Next route params without an application router.
vi.mock('@/next/navigation', () => ({ useParams: () => ({}), usePathname: () => '/chat' }))

beforeEach(async () => {
  await page.viewport(1000, 800)
  onTestFinished(guardUnexpectedFetch())
})

function Siblings({ domain }: { domain: 'question' | 'answer' | 'form' }) {
  const [index, setIndex] = useState(1)
  const items: ChatItem[] = ['First', 'Middle', 'Last'].map((name, i) =>
    chatItem({
      id: `sibling-${i}`,
      content: domain === 'form' ? '' : `${name} ${domain}`,
      isAnswer: domain !== 'question',
      humanInputFormDataList:
        domain === 'form' ? [{ ...pendingForm, node_title: `${name} review` }] : undefined,
      siblingCount: 3,
      siblingIndex: i,
      prevSibling: i ? `sibling-${i - 1}` : undefined,
      nextSibling: i < 2 ? `sibling-${i + 1}` : undefined,
    }),
  )
  return (
    <div style={{ height: 600 }}>
      <Chat
        chatList={[items[index]!]}
        noChatInput
        switchSibling={(id) => setIndex(items.findIndex((item) => item.id === id))}
      />
    </div>
  )
}

it.each(['question', 'answer', 'form'] as const)(
  'navigates real %s siblings, updates content and prevents endpoint navigation',
  async (domain) => {
    await renderChatOwner(<Siblings domain={domain} />)
    const label = (name: string) => (domain === 'form' ? `${name} review` : `${name} ${domain}`)
    await expect.element(page.getByText(label('Middle'), { exact: true })).toBeVisible()
    await expect.element(page.getByText('2 /3')).toBeVisible()
    await page.getByRole('button', { name: 'Previous' }).click()
    await expect.element(page.getByText(label('First'), { exact: true })).toBeVisible()
    await expect.element(page.getByText(label('Middle'), { exact: true })).not.toBeInTheDocument()
    await expect.element(page.getByRole('button', { name: 'Previous' })).toBeDisabled()
    await expect.element(page.getByText('1 /3')).toBeVisible()
    await page.getByRole('button', { name: 'Next' }).click()
    await expect.element(page.getByText(label('Middle'), { exact: true })).toBeVisible()
    await page.getByRole('button', { name: 'Next' }).click()
    await expect.element(page.getByText(label('Last'), { exact: true })).toBeVisible()
    await expect.element(page.getByText('3 /3')).toBeVisible()
    await expect.element(page.getByRole('button', { name: 'Next' })).toBeDisabled()
  },
)

it.each([
  { siblingCount: 1, siblingIndex: 0 },
  { siblingCount: 3, siblingIndex: undefined },
])('omits sibling navigation when no indexed choice exists: %j', async (props) => {
  await renderChatOwner(<Chat chatList={[chatItem(props)]} noChatInput />)
  await expect.element(page.getByText('An answer')).toBeVisible()
  await expect.element(page.getByRole('button', { name: 'Previous' })).not.toBeInTheDocument()
  await expect.element(page.getByRole('button', { name: 'Next' })).not.toBeInTheDocument()
})
