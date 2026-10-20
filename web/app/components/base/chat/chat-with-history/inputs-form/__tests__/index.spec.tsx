import type { ChatWithHistoryContextValue } from '../../context'
import { act, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { useState } from 'react'
import { InputVarType } from '@/app/components/workflow/types'
import { ChatWithHistoryContext, useChatWithHistoryContext } from '../../context'
import InputsFormNode from '../index'

function Conversation({
  overrides = {},
  initiallyCollapsed = true,
}: {
  overrides?: Partial<ChatWithHistoryContextValue>
  initiallyCollapsed?: boolean
}) {
  const defaults = useChatWithHistoryContext()
  const [collapsed, setCollapsed] = useState(initiallyCollapsed)
  return (
    <ChatWithHistoryContext.Provider
      value={{
        ...defaults,
        inputsForms: [{ variable: 'topic', type: InputVarType.textInput, label: 'Topic' }],
        ...overrides,
      }}
    >
      <InputsFormNode collapsed={collapsed} setCollapsed={setCollapsed} />
    </ChatWithHistoryContext.Provider>
  )
}

describe('InputsFormNode', () => {
  it.each([{ allInputsHidden: true }, { inputsForms: [] }])(
    'omits settings when no inputs are available: %j',
    (overrides) => {
      const { container } = render(<Conversation overrides={overrides} />)
      expect(container).toBeEmptyDOMElement()
    },
  )

  it('opens and closes settings for an existing conversation', async () => {
    const user = userEvent.setup()
    render(<Conversation overrides={{ currentConversationId: 'conv-1' }} />)
    expect(screen.queryByRole('textbox', { name: 'Topic' })).not.toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'common.operation.edit' }))
    expect(screen.getByRole('textbox', { name: 'Topic' })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'share.chat.startChat' })).not.toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'common.operation.close' }))
    expect(screen.queryByRole('textbox', { name: 'Topic' })).not.toBeInTheDocument()
  })

  it('collapses new conversation settings only after starting chat succeeds', async () => {
    const user = userEvent.setup()
    const handleStartChat = vi.fn<ChatWithHistoryContextValue['handleStartChat']>()
    render(<Conversation initiallyCollapsed={false} overrides={{ handleStartChat }} />)
    await user.click(screen.getByRole('button', { name: 'share.chat.startChat' }))
    expect(handleStartChat).toHaveBeenCalledTimes(1)
    expect(screen.getByRole('textbox', { name: 'Topic' })).toBeInTheDocument()
    act(() => handleStartChat.mock.calls[0]![0]?.())
    expect(screen.queryByRole('textbox', { name: 'Topic' })).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'common.operation.edit' })).toBeInTheDocument()
  })
})
