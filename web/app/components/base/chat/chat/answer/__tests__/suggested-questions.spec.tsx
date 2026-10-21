import type { IChatItem } from '../../type'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { ChatContextProvider } from '../../context-provider'
import SuggestedQuestions from '../suggested-questions'

const item: IChatItem = {
  id: '1',
  content: '',
  isAnswer: true,
  isOpeningStatement: true,
  suggestedQuestions: ['What is Dify?', 'How to use it?', '  ', ''],
}

it('filters blank questions and sends the selected suggestion from the opening statement', async () => {
  const user = userEvent.setup()
  const onSend = vi.fn()
  const { rerender } = render(
    <ChatContextProvider chatList={[]} onSend={onSend}>
      <SuggestedQuestions item={item} />
    </ChatContextProvider>,
  )
  expect(screen.getAllByRole('button').map((button) => button.textContent)).toEqual([
    'What is Dify?',
    'How to use it?',
  ])
  await user.click(screen.getByRole('button', { name: 'What is Dify?' }))
  expect(onSend).toHaveBeenCalledExactlyOnceWith('What is Dify?')
  rerender(
    <ChatContextProvider chatList={[]} onSend={onSend}>
      <SuggestedQuestions item={{ ...item, isOpeningStatement: false }} />
    </ChatContextProvider>,
  )
  expect(screen.queryByRole('button')).not.toBeInTheDocument()
})

it('disables suggestions in readonly conversations', async () => {
  const user = userEvent.setup()
  const onSend = vi.fn()
  render(
    <ChatContextProvider chatList={[]} readonly onSend={onSend}>
      <SuggestedQuestions item={item} />
    </ChatContextProvider>,
  )
  const question = screen.getByRole('button', { name: 'What is Dify?' })
  expect(question).toBeDisabled()
  // readonly also removes pointer events; keyboard activation exercises the disabled control.
  question.focus()
  await user.keyboard('{Enter}')
  expect(onSend).not.toHaveBeenCalled()
})
