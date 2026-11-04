import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { useRef, useState } from 'react'
import { InputVarType } from '@/app/components/workflow/types'
import { ChatWithHistoryContext, useChatWithHistoryContext } from '../../context'
import ViewFormDropdown from '../view-form-dropdown'

function Conversation() {
  const defaults = useChatWithHistoryContext()
  const [inputs, setInputs] = useState({ topic: 'Original topic' })
  const inputsRef = useRef(inputs)
  return (
    <ChatWithHistoryContext.Provider
      value={{
        ...defaults,
        currentConversationId: 'conversation-1',
        inputsForms: [{ variable: 'topic', type: InputVarType.textInput, label: 'Topic' }],
        currentConversationInputs: inputs,
        newConversationInputs: inputs,
        newConversationInputsRef: inputsRef,
        setCurrentConversationInputs: (next) => setInputs({ topic: next.topic }),
        handleNewConversationInputsChange: (next) => {
          inputsRef.current = { topic: next.topic }
        },
      }}
    >
      <ViewFormDropdown />
    </ChatWithHistoryContext.Provider>
  )
}

it('edits conversation settings in the popup and preserves them when reopened', async () => {
  const user = userEvent.setup()
  render(<Conversation />)
  const trigger = screen.getByRole('button', { name: 'share.chat.viewChatSettings' })
  await user.click(trigger)
  const input = screen.getByRole('textbox', { name: 'Topic' })
  expect(input).toHaveValue('Original topic')
  await user.clear(input)
  await user.type(input, 'Updated topic')
  await user.click(trigger)
  expect(screen.queryByRole('textbox', { name: 'Topic' })).not.toBeInTheDocument()
  await user.click(trigger)
  expect(screen.getByRole('textbox', { name: 'Topic' })).toHaveValue('Updated topic')
})
