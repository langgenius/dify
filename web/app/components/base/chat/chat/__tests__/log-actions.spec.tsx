import type { ChatItem } from '../../types'
import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import Chat from '../index'

// Keep the Chat/context/Operation/Log capability path real while omitting rich answer rendering.
vi.mock('../answer', async () => {
  const { default: Operation } = await import('../answer/operation')
  return {
    default: ({ item }: { item: ChatItem }) => (
      <Operation
        item={item}
        question=""
        index={0}
        maxSize={500}
        contentWidth={100}
        hasWorkflowProcess={false}
      />
    ),
  }
})

vi.mock('../question', () => ({ default: () => null }))
vi.mock('../chat-input-area', () => ({ default: () => null }))
vi.mock('@/app/components/base/new-audio-button', () => ({ default: () => null }))
vi.mock('@/app/components/app/annotation/edit-annotation-modal', () => ({ default: () => null }))
vi.mock(
  '@/app/components/base/features/new-feature-panel/annotation-reply/annotation-ctrl-button',
  () => ({ default: () => null }),
)

const firstAnswer: ChatItem = { id: 'first-answer', content: 'First answer', isAnswer: true }
const secondAnswer: ChatItem = { id: 'second-answer', content: 'Second answer', isAnswer: true }

describe('Chat log actions', () => {
  it('keeps two mounted chat surfaces connected to their own log owner', async () => {
    const user = userEvent.setup()
    const onFirstLog = vi.fn()
    const onSecondLog = vi.fn()
    render(
      <>
        <section aria-label="First chat">
          <Chat chatList={[firstAnswer]} noChatInput onOpenLog={onFirstLog} />
        </section>
        <section aria-label="Second chat">
          <Chat chatList={[secondAnswer]} noChatInput onOpenLog={onSecondLog} />
        </section>
      </>,
    )

    await user.click(
      within(screen.getByRole('region', { name: 'Second chat' })).getByRole('button', {
        name: /operation\.log/,
      }),
    )
    expect(onSecondLog).toHaveBeenCalledExactlyOnceWith(secondAnswer)
    expect(onFirstLog).not.toHaveBeenCalled()

    await user.click(
      within(screen.getByRole('region', { name: 'First chat' })).getByRole('button', {
        name: /operation\.log/,
      }),
    )
    expect(onFirstLog).toHaveBeenCalledExactlyOnceWith(firstAnswer)
    expect(onSecondLog).toHaveBeenCalledTimes(1)
  })

  it('removes the log action when its owner withdraws the capability', () => {
    const { rerender } = render(<Chat chatList={[firstAnswer]} noChatInput onOpenLog={vi.fn()} />)
    expect(screen.getByRole('button', { name: /operation\.log/ })).toBeInTheDocument()

    rerender(<Chat chatList={[firstAnswer]} noChatInput />)
    expect(screen.queryByRole('button', { name: /operation\.log/ })).not.toBeInTheDocument()
  })
})
