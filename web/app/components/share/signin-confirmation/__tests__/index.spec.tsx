import type { ComponentProps } from 'react'
import { render, screen, within } from '@testing-library/react'
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

it('selects adding earlier data by default and submits the selected action', async () => {
  const user = userEvent.setup()
  const onConfirm = vi.fn()
  render(
    <SignInConfirmation
      accountName="Reader"
      app={app}
      continueHref="/chat/current-app"
      onConfirm={onConfirm}
    />,
  )

  const addOption = screen.getByRole('radio', { name: 'login.history.add' })
  const deleteOption = screen.getByRole('radio', { name: 'login.history.delete' })
  expect(within(addOption).getByRole('note')).toHaveTextContent('login.history.transferWarning')
  expect(addOption).toHaveAccessibleDescription(
    'login.history.addDescription login.history.transferWarning',
  )
  expect(addOption).toBeChecked()
  expect(deleteOption).not.toBeChecked()
  expect(screen.getByRole('button', { name: 'login.history.addAndContinue' })).toBeEnabled()
  await user.click(screen.getByRole('button', { name: 'login.history.addAndContinue' }))
  expect(onConfirm).toHaveBeenCalledExactlyOnceWith('add')

  await user.click(screen.getByText('login.history.delete'))
  expect(deleteOption).toBeChecked()
  expect(addOption).not.toBeChecked()
  expect(within(addOption).getByRole('note')).toBeVisible()
  const deleteButton = screen.getByRole('button', { name: 'login.history.deleteAndContinue' })
  expect(deleteButton).toBeEnabled()

  await user.click(deleteButton)
  expect(onConfirm).toHaveBeenLastCalledWith('delete')

  await user.click(screen.getByText('login.history.add'))
  await user.click(screen.getByRole('button', { name: 'login.history.addAndContinue' }))
  expect(onConfirm).toHaveBeenCalledTimes(3)
  expect(onConfirm).toHaveBeenLastCalledWith('add')
})

it.each([null, 'add', 'delete'] as const)(
  'allows deferring with choice %s without submitting history',
  async (choice) => {
    const user = userEvent.setup()
    const onConfirm = vi.fn()
    render(
      <SignInConfirmation
        accountName="Reader"
        app={app}
        continueHref="/chat/current-app?conversationId=existing-chat"
        onConfirm={onConfirm}
      />,
    )

    if (choice) await user.click(screen.getByRole('radio', { name: `login.history.${choice}` }))
    const notNow = screen.getByRole('link', { name: 'login.history.notNow' })
    expect(notNow).toHaveAttribute('href', '/chat/current-app?conversationId=existing-chat')
    await user.click(notNow)

    expect(onConfirm).not.toHaveBeenCalled()
  },
)

it('defaults to continuing without adding data when migration is unsupported and allows deletion instead', async () => {
  const user = userEvent.setup()
  const onConfirm = vi.fn()
  render(
    <SignInConfirmation
      accountName="Reader"
      supportsMigration={false}
      app={app}
      continueHref="/chat/current-app"
      onConfirm={onConfirm}
    />,
  )

  expect(screen.getByText('login.history.unsupportedTitle')).toBeInTheDocument()
  expect(screen.getByText('login.history.unsupportedDescription')).toBeInTheDocument()
  expect(screen.queryByRole('radio', { name: 'login.history.add' })).not.toBeInTheDocument()
  expect(screen.queryByRole('note')).not.toBeInTheDocument()
  expect(screen.queryByRole('link', { name: 'login.history.notNow' })).not.toBeInTheDocument()
  const continueOption = screen.getByRole('radio', {
    name: 'login.history.continueWithoutAdding',
  })
  const deleteOption = screen.getByRole('radio', { name: 'login.history.delete' })
  expect(continueOption).toBeChecked()
  expect(deleteOption).not.toBeChecked()
  expect(screen.getByRole('button', { name: 'login.history.continue' })).toBeEnabled()

  await user.click(screen.getByRole('button', { name: 'login.history.continue' }))
  expect(onConfirm).toHaveBeenCalledExactlyOnceWith('continue')

  await user.click(deleteOption)
  await user.click(screen.getByRole('button', { name: 'login.history.deleteAndContinue' }))
  expect(onConfirm).toHaveBeenLastCalledWith('delete')
})
