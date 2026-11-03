import type { OpenUiContentBlock } from '@dify/contracts/api/console/agent/types.gen'
import type { ChatItem } from '../../../types'
import { screen } from '@testing-library/react'
import { renderWithConsoleQuery } from '@/test/console/query-data'
import { ChatContextProvider } from '../../context-provider'
import Answer from '../index'

const intro = 'Results \u{1F4CA}: East leads.\n\n'
const advice = 'Consider costs when evaluating efficiency.'
const block: OpenUiContentBlock = {
  id: 'regions',
  type: 'openui',
  library_version: 'dify-ui-v1',
  text_offset: Array.from(intro).length,
  source: 'root = Stack([Table("Regional sales", ["Region", "Sales"], [["East", "72"]])])',
  status: 'completed',
  sequence: 2,
  form_state: {},
}

function expectBefore(first: HTMLElement, second: HTMLElement) {
  expect(first.compareDocumentPosition(second) & Node.DOCUMENT_POSITION_FOLLOWING).not.toBe(0)
}

describe('ordered text and UI answers', () => {
  beforeAll(async () => {
    await import('@/features/generative-ui/renderer')
    await import('@/app/components/base/markdown/streamdown-wrapper')
  }, 30_000)

  it.each([false, true])(
    'preserves paragraph, UI, advice order with human inputs=%s',
    async (humanInputs) => {
      const item: ChatItem = {
        id: 'answer',
        isAnswer: true,
        content: intro + advice,
        content_blocks: [block],
        humanInputFilledFormDataList: humanInputs
          ? [
              {
                form_id: 'approval',
                node_id: 'review',
                node_title: 'Review',
                rendered_content: 'Approved',
                action_id: 'approve',
                action_text: 'Approve',
              },
            ]
          : undefined,
      }
      renderWithConsoleQuery(
        <ChatContextProvider chatList={[item]}>
          <Answer item={item} question="Compare regional sales" index={0} />
        </ChatContextProvider>,
      )
      const table = await screen.findByRole('table', { name: 'Regional sales' })
      expectBefore(await screen.findByText(intro.trim()), table)
      expectBefore(table, await screen.findByText(advice))
    },
  )

  it('keeps adjacent blocks in order as trailing prose streams and history is restored', async () => {
    const secondBlock: OpenUiContentBlock = {
      ...block,
      id: 'status',
      source: 'root = Stack([Heading("Follow-up investigation")])',
    }
    const item: ChatItem = {
      id: 'answer',
      isAnswer: true,
      content: intro,
      content_blocks: [block, secondBlock],
    }
    const view = (answer: ChatItem, responding: boolean) => (
      <ChatContextProvider chatList={[answer]}>
        <Answer item={answer} question="Compare regional sales" index={0} responding={responding} />
      </ChatContextProvider>
    )
    const { rerender, unmount } = renderWithConsoleQuery(view(item, true))
    const table = await screen.findByRole('table', { name: 'Regional sales' })
    const heading = screen.getByRole('heading', { name: 'Follow-up investigation' })
    expectBefore(table, heading)
    const complete = { ...item, content: intro + advice }
    rerender(view(complete, false))
    expectBefore(heading, await screen.findByText(advice))
    unmount()
    renderWithConsoleQuery(view(complete, false))
    expectBefore(
      await screen.findByRole('table', { name: 'Regional sales' }),
      screen.getByRole('heading', { name: 'Follow-up investigation' }),
    )
    expectBefore(
      screen.getByRole('heading', { name: 'Follow-up investigation' }),
      await screen.findByText(advice),
    )
  })
})
