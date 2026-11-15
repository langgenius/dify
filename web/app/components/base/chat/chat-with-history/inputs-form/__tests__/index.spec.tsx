import { screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { useState } from 'react'
import { fetchChatList, fetchConversations } from '@/service/share'
import { createChatConfigFixture } from '@/test/fixtures/chat'
import { CONVERSATION_ID_INFO, TAB_CONVERSATION_ID_INFO } from '../../../constants'
import { renderChatHistory } from '../../__tests__/chat-history-test-env'
import InputsFormNode from '../index'

vi.mock('@/service/share', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/service/share')>()),
  fetchChatList: vi.fn(),
  fetchConversations: vi.fn(),
}))

function Conversation({ initiallyCollapsed = true }: { initiallyCollapsed?: boolean }) {
  const [collapsed, setCollapsed] = useState(initiallyCollapsed)
  return <InputsFormNode collapsed={collapsed} setCollapsed={setCollapsed} />
}
const topic = { label: 'Topic', variable: 'topic', required: true, default: '' }
const appParams = createChatConfigFixture({ user_input_form: [{ 'text-input': topic }] })

beforeEach(() => {
  vi.mocked(fetchChatList).mockResolvedValue({ data: [] })
  vi.mocked(fetchConversations).mockResolvedValue({ data: [], has_more: false, limit: 100 })
})
afterEach(() => {
  localStorage.removeItem(CONVERSATION_ID_INFO)
  sessionStorage.removeItem(TAB_CONVERSATION_ID_INFO)
  localStorage.removeItem('webappSidebarCollapse')
})

describe('InputsFormNode', () => {
  it.each([
    { name: 'hidden inputs', user_input_form: [{ 'text-input': { ...topic, hide: true } }] },
    { name: 'no inputs', user_input_form: [] },
  ])('omits settings for $name', ({ user_input_form }) => {
    const { container } = renderChatHistory(<Conversation />, {
      appParams: createChatConfigFixture({ user_input_form }),
    })
    expect(container).toBeEmptyDOMElement()
  })

  it('opens and closes settings for an existing conversation', async () => {
    const user = userEvent.setup()
    renderChatHistory(<Conversation />, { appParams })
    expect(screen.queryByRole('textbox', { name: 'Topic' })).not.toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'common.operation.edit' }))
    expect(screen.getByRole('textbox', { name: 'Topic' })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'share.chat.startChat' })).not.toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'common.operation.close' }))
    expect(screen.queryByRole('textbox', { name: 'Topic' })).not.toBeInTheDocument()
  })

  it('collapses new conversation settings only after starting chat succeeds', async () => {
    const user = userEvent.setup()
    renderChatHistory(<Conversation initiallyCollapsed={false} />, {
      currentConversationId: '',
      appParams,
    })
    await user.click(screen.getByRole('button', { name: 'share.chat.startChat' }))
    expect(screen.getByRole('textbox', { name: 'Topic' })).toBeVisible()
    await user.type(screen.getByRole('textbox', { name: 'Topic' }), 'Travel')
    await user.click(screen.getByRole('button', { name: 'share.chat.startChat' }))
    expect(screen.queryByRole('textbox', { name: 'Topic' })).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'common.operation.edit' })).toBeVisible()
  })
})
