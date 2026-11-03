import type { IChatItem } from '@/app/components/base/chat/chat/type'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import PromptLogModal from '..'

const item = (log?: IChatItem['log']): IChatItem => ({
  id: '1',
  content: 'test',
  isAnswer: true,
  log,
})

it('copies the single prompt and closes only when the owner is dismissed', async () => {
  const user = userEvent.setup()
  const writeText = vi.spyOn(navigator.clipboard, 'writeText').mockResolvedValue(undefined)
  const onCancel = vi.fn()
  render(
    <PromptLogModal
      width={1000}
      onCancel={onCancel}
      currentLogItem={item([{ role: 'user', text: 'Hello' }])}
    />,
  )
  await user.click(screen.getByText('Hello'))
  expect(onCancel).not.toHaveBeenCalled()
  await user.click(screen.getByRole('button', { name: 'common.operation.copy' }))
  await waitFor(() => expect(writeText).toHaveBeenCalledExactlyOnceWith('Hello'))
  expect(onCancel).not.toHaveBeenCalled()
  await user.click(screen.getByRole('button', { name: 'common.operation.close' }))
  expect(onCancel).toHaveBeenCalledOnce()
  writeText.mockRestore()
})

it('shows each role and copies the selected message from a multi-message prompt', async () => {
  const user = userEvent.setup()
  const writeText = vi.spyOn(navigator.clipboard, 'writeText').mockResolvedValue(undefined)
  render(
    <PromptLogModal
      width={1000}
      onCancel={vi.fn()}
      currentLogItem={item([
        { role: 'user', text: 'Hello' },
        { role: 'assistant', text: 'Hi there' },
      ])}
    />,
  )
  expect(screen.getByText('USER')).toBeInTheDocument()
  expect(screen.getByText('ASSISTANT')).toBeInTheDocument()
  expect(screen.getByText('Hi there')).toBeInTheDocument()
  await user.click(screen.getAllByRole('button', { name: 'common.operation.copy' })[1]!)
  await waitFor(() => expect(writeText).toHaveBeenCalledExactlyOnceWith('Hi there'))
  writeText.mockRestore()
})

it('dismisses the prompt when clicking outside', async () => {
  const user = userEvent.setup()
  const onCancel = vi.fn()
  render(
    <>
      <button>Outside</button>
      <PromptLogModal
        width={1000}
        onCancel={onCancel}
        currentLogItem={item([{ role: 'user', text: 'Hello' }])}
      />
    </>,
  )
  await user.click(screen.getByRole('button', { name: 'Outside' }))
  expect(onCancel).toHaveBeenCalledOnce()
})
