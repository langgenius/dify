import type { ComponentProps } from 'react'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import SignInConfirmation from '..'

const app: ComponentProps<typeof SignInConfirmation>['app'] = {
  title: 'Research Assistant',
  description: 'Find and organize useful research.',
  icon: '🤖',
  icon_type: 'emoji',
  icon_background: '#FFEAD5',
  icon_url: null,
}

it('requires a history choice and submits only the currently selected action', async () => {
  const user = userEvent.setup()
  const onConfirm = vi.fn()
  render(
    <SignInConfirmation
      email="reader@example.com"
      conversationCount={3}
      app={app}
      onConfirm={onConfirm}
    />,
  )

  const addOption = screen.getByRole('radio', { name: 'login.history.add' })
  const deleteOption = screen.getByRole('radio', { name: 'login.history.delete' })
  expect(addOption).not.toBeChecked()
  expect(deleteOption).not.toBeChecked()
  expect(screen.getByRole('button', { name: 'login.history.continue' })).toBeDisabled()

  await user.click(screen.getByText('login.history.add'))
  expect(addOption).toBeChecked()
  expect(deleteOption).not.toBeChecked()
  expect(screen.getByRole('button', { name: 'login.history.addAndContinue' })).toBeEnabled()

  await user.click(screen.getByText('login.history.delete'))
  expect(deleteOption).toBeChecked()
  expect(addOption).not.toBeChecked()
  const deleteButton = screen.getByRole('button', { name: 'login.history.deleteAndContinue' })
  expect(deleteButton).toBeEnabled()
  expect(onConfirm).not.toHaveBeenCalled()

  await user.click(deleteButton)
  expect(onConfirm).toHaveBeenCalledExactlyOnceWith('delete')

  await user.click(screen.getByText('login.history.add'))
  await user.click(screen.getByRole('button', { name: 'login.history.addAndContinue' }))
  expect(onConfirm).toHaveBeenCalledTimes(2)
  expect(onConfirm).toHaveBeenLastCalledWith('add')
})

it('switches accounts without submitting the selected history action', async () => {
  const user = userEvent.setup()
  const onConfirm = vi.fn()
  const onSwitchAccount = vi.fn()
  render(
    <SignInConfirmation
      email="reader@example.com"
      conversationCount={3}
      app={app}
      onConfirm={onConfirm}
      onSwitchAccount={onSwitchAccount}
    />,
  )

  await user.click(screen.getByText('login.history.delete'))
  await user.click(screen.getByRole('button', { name: 'login.history.useDifferentAccount' }))

  expect(onSwitchAccount).toHaveBeenCalledOnce()
  expect(onConfirm).not.toHaveBeenCalled()
})
