import type { EmbeddedChatbotContextValue } from '../../context'
import { act, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { useState } from 'react'
import { InputVarType } from '@/app/components/workflow/types'
import { createEmbeddedChatbotContextFixture } from '@/test/fixtures/embedded-chatbot'
import { useEmbeddedChatbotContext } from '../../context'
import InputsFormNode from '../index'

vi.mock('../../context', () => ({ useEmbeddedChatbotContext: vi.fn() }))

const inputsForms = [
  { variable: 'topic', label: 'Topic', type: InputVarType.textInput, required: true },
]
const setContext = (overrides: Partial<EmbeddedChatbotContextValue> = {}) => {
  vi.mocked(useEmbeddedChatbotContext).mockReturnValue(
    createEmbeddedChatbotContextFixture({ inputsForms, ...overrides }),
  )
}
function Form({ initiallyCollapsed = false }) {
  const [collapsed, setCollapsed] = useState(initiallyCollapsed)
  return <InputsFormNode collapsed={collapsed} setCollapsed={setCollapsed} />
}

it.each([{ allInputsHidden: true }, { inputsForms: [] }])(
  'omits settings when no input can be edited: %j',
  (overrides) => {
    setContext(overrides)
    render(<Form />)
    expect(screen.queryByRole('textbox')).not.toBeInTheDocument()
    expect(screen.queryByRole('button')).not.toBeInTheDocument()
  },
)

it('collapses a new conversation only after starting chat succeeds', async () => {
  const user = userEvent.setup()
  const start = vi.fn<EmbeddedChatbotContextValue['handleStartChat']>()
  setContext({ handleStartChat: start })
  render(<Form />)
  await user.click(screen.getByRole('button', { name: 'share.chat.startChat' }))
  expect(start).toHaveBeenCalledTimes(1)
  expect(screen.getByRole('textbox', { name: 'Topic' })).toBeInTheDocument()
  act(() => start.mock.calls[0]![0]!())
  expect(screen.queryByRole('textbox', { name: 'Topic' })).not.toBeInTheDocument()
  await user.click(screen.getByRole('button', { name: 'common.operation.edit' }))
  expect(screen.getByRole('textbox', { name: 'Topic' })).toBeInTheDocument()
})

it('lets an existing conversation reopen and close its settings without starting a new chat', async () => {
  const user = userEvent.setup()
  const start = vi.fn()
  setContext({
    currentConversationId: 'conv-123',
    currentConversationInputs: { topic: 'Existing topic' },
    handleStartChat: start,
  })
  render(<Form initiallyCollapsed />)
  await user.click(screen.getByRole('button', { name: 'common.operation.edit' }))
  expect(screen.getByRole('textbox', { name: 'Topic' })).toHaveValue('Existing topic')
  expect(screen.queryByRole('button', { name: 'share.chat.startChat' })).not.toBeInTheDocument()
  await user.click(screen.getByRole('button', { name: 'common.operation.close' }))
  expect(screen.queryByRole('textbox', { name: 'Topic' })).not.toBeInTheDocument()
  expect(start).not.toHaveBeenCalled()
})
