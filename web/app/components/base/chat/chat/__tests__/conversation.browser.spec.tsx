import type { ChatProps } from '../index'
import { useState } from 'react'
import { page, userEvent } from 'vite-plus/test/browser'
import { createChatConfigFixture } from '@/test/fixtures/chat'
import { guardUnexpectedFetch } from '@/test/unexpected-fetch'
import Chat from '../index'
import { chatItem, renderChatOwner } from './chat-owner-preset'

vi.unmock('react-i18next')
// boundary: Chat reads route params without a running Next application.
vi.mock('@/next/navigation', () => ({ useParams: () => ({}), usePathname: () => '/chat' }))

beforeEach(async () => {
  await page.viewport(1000, 800)
  onTestFinished(guardUnexpectedFetch())
})

function Conversation(props: Partial<ChatProps>) {
  const [messages, setMessages] = useState(props.chatList ?? [])
  const [responding, setResponding] = useState(!!props.isResponding)
  return (
    <div style={{ height: 600 }}>
      <Chat
        {...props}
        chatList={messages}
        isResponding={responding}
        onSend={(content) =>
          setMessages((items) => [
            ...items,
            chatItem({ id: `q-${items.length}`, content, isAnswer: false }),
          ])
        }
        onRegenerate={(item, edited) =>
          setMessages((items) =>
            items.map((message) =>
              message.id === item.id
                ? { ...message, content: edited?.message ?? message.content }
                : message,
            ),
          )
        }
        onStopResponding={() => setResponding(false)}
      />
    </div>
  )
}

it('sends native Enter input and displays the accepted message with an empty composer', async () => {
  await renderChatOwner(<Conversation inputPlaceholder="Ask the assistant" />)
  const input = page.getByPlaceholder('Ask the assistant')
  await input.fill('Hello')
  await userEvent.keyboard('{Enter}')
  await expect.element(page.getByText('Hello', { exact: true })).toBeVisible()
  await expect.element(input).toHaveValue('')
  await expect.element(input).toHaveFocus()
})

it('lays out messages in conversation order and exposes the last answer actions only after streaming', async () => {
  const messages = [
    chatItem({ id: 'q1', content: 'First question', isAnswer: false }),
    chatItem({ id: 'a1', content: 'First answer' }),
    chatItem({ id: 'q2', content: 'Second question', isAnswer: false }),
    chatItem({ id: 'a2', content: 'Second answer' }),
  ]
  const screen = await renderChatOwner(
    <div style={{ height: 600 }}>
      <Chat chatList={messages} isResponding noChatInput />
    </div>,
  )
  for (const message of messages)
    await expect.element(page.getByText(message.content, { exact: true })).toBeVisible()
  const tops = messages.map(
    (message) =>
      page.getByText(message.content, { exact: true }).element().getBoundingClientRect().top,
  )
  expect(tops).toEqual([...tops].sort((a, b) => a - b))
  expect(new Set(tops).size).toBe(4)
  const firstAnswer = page.getByTestId('chat-answer-container').filter({ hasText: 'First answer' })
  const lastAnswer = page.getByTestId('chat-answer-container').filter({ hasText: 'Second answer' })
  await firstAnswer.hover()
  await expect.element(firstAnswer.getByRole('button', { name: 'Copy', exact: true })).toBeVisible()
  await lastAnswer.hover()
  await expect
    .element(lastAnswer.getByRole('button', { name: 'Copy', exact: true }))
    .not.toBeInTheDocument()
  await screen.rerender(
    <div style={{ height: 600 }}>
      <Chat chatList={messages} isResponding={false} noChatInput />
    </div>,
  )
  await lastAnswer.hover()
  await expect.element(lastAnswer.getByRole('button', { name: 'Copy', exact: true })).toBeVisible()
})

it('edits a question through the real Chat owner and then withdraws editing permission', async () => {
  const question = chatItem({ id: 'question', isAnswer: false, content: 'Original question' })
  const screen = await renderChatOwner(
    <Conversation
      chatList={[question]}
      noChatInput
      config={createChatConfigFixture({ questionEditEnable: true })}
    />,
  )
  await page.getByText('Original question').hover()
  await page.getByRole('button', { name: 'Edit', exact: true }).click()
  const input = page.getByRole('textbox')
  await expect.element(input).toHaveFocus()
  await input.fill('Revised question')
  await userEvent.keyboard('{Enter}')
  await expect.element(input).not.toBeInTheDocument()
  await expect.element(page.getByText('Revised question')).toBeVisible()
  await screen.rerender(
    <Conversation
      chatList={[question]}
      noChatInput
      config={createChatConfigFixture({ questionEditEnable: false })}
    />,
  )
  await page.getByText('Revised question').hover()
  await expect
    .element(page.getByRole('button', { name: 'Edit', exact: true }))
    .not.toBeInTheDocument()
})

it('activates a follow-up by keyboard and renders that selected question', async () => {
  await renderChatOwner(
    <Conversation
      config={createChatConfigFixture({ suggested_questions_after_answer: { enabled: true } })}
      suggestedQuestions={['First question', 'Second question']}
      noChatInput
    />,
  )
  await userEvent.tab()
  await expect.element(page.getByRole('button', { name: 'First question' })).toHaveFocus()
  await userEvent.tab()
  await expect.element(page.getByRole('button', { name: 'Second question' })).toHaveFocus()
  await userEvent.keyboard('{Enter}')
  await expect
    .element(page.getByTestId('question-content').getByText('Second question'))
    .toBeVisible()
})

it.each([
  { scenario: 'missing config', props: { config: undefined } },
  { scenario: 'disabled config', props: { config: createChatConfigFixture() } },
  { scenario: 'empty suggestions', props: { suggestedQuestions: [] } },
  { scenario: 'missing sender', props: { onSend: undefined } },
])('omits follow-up actions with $scenario', async ({ props }) => {
  await renderChatOwner(
    <Chat
      chatList={[]}
      noChatInput
      config={createChatConfigFixture({ suggested_questions_after_answer: { enabled: true } })}
      suggestedQuestions={['Ask this']}
      onSend={() => {}}
      {...props}
    />,
  )
  await expect.element(page.getByRole('button', { name: 'Ask this' })).not.toBeInTheDocument()
})

it('filters opening suggestions, sends a real selection, and removes suggestions on a normal answer', async () => {
  const opening = chatItem({
    content: 'Welcome',
    isOpeningStatement: true,
    suggestedQuestions: ['What is Dify?', 'How to use it?', '  ', ''],
  })
  const screen = await renderChatOwner(<Conversation chatList={[opening]} noChatInput />)
  await expect.element(page.getByRole('button', { name: 'What is Dify?' })).toBeVisible()
  expect(page.getByRole('button').all()).toHaveLength(2)
  await page.getByRole('button', { name: 'What is Dify?' }).click()
  await expect
    .element(page.getByTestId('question-content').getByText('What is Dify?'))
    .toBeVisible()
  // Public item replacement exercises the opening-statement guard at its real owner.
  await screen.rerender(<Chat chatList={[{ ...opening, isOpeningStatement: false }]} noChatInput />)
  await expect.element(page.getByRole('button', { name: 'How to use it?' })).not.toBeInTheDocument()
})

it('keeps opening suggestions disabled in a readonly conversation', async () => {
  await renderChatOwner(
    <Conversation
      readonly
      noChatInput
      chatList={[chatItem({ isOpeningStatement: true, suggestedQuestions: ['What is Dify?'] })]}
    />,
  )
  await expect.element(page.getByRole('button', { name: 'What is Dify?' })).toBeDisabled()
  await userEvent.tab()
  await expect.element(page.getByRole('button', { name: 'What is Dify?' })).not.toHaveFocus()
  await expect.element(page.getByTestId('question-content')).not.toBeInTheDocument()
})

it('stops streaming through the visible control and removes it after the owner settles', async () => {
  await renderChatOwner(<Conversation isResponding noChatInput />)
  await page.getByRole('button', { name: 'Stop responding' }).click()
  await expect
    .element(page.getByRole('button', { name: 'Stop responding' }))
    .not.toBeInTheDocument()
})

it('honors the owner stop/input capabilities while retaining conversation content', async () => {
  const screen = await renderChatOwner(<Chat chatList={[]} isResponding noStopResponding />)
  await expect
    .element(page.getByRole('button', { name: 'Stop responding' }))
    .not.toBeInTheDocument()
  await screen.rerender(
    <Chat chatList={[chatItem({ content: 'Conversation archived' })]} noChatInput />,
  )
  await expect.element(page.getByRole('textbox')).not.toBeInTheDocument()
  await expect.element(page.getByText('Conversation archived')).toBeVisible()
})

it.each([{ readonly: true }, { inputDisabled: true }])(
  'blocks native input for %j',
  async (props) => {
    await renderChatOwner(<Conversation {...props} />)
    const input = page.getByRole('textbox')
    if (props.readonly) await expect.element(input).toHaveAttribute('readonly')
    else await expect.element(input).toBeDisabled()
    await expect.element(page.getByRole('button', { name: 'Send' })).toBeDisabled()
    await expect.element(page.getByTestId('question-content')).not.toBeInTheDocument()
  },
)
