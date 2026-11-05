import { useState } from 'react'
import { render } from 'vitest-browser-react'
import SignInConfirmation from '..'

const app = {
  title: 'Research Assistant',
  description: 'Find and organize useful research.',
  icon: '🤖',
  icon_type: 'emoji' as const,
  icon_background: '#FFEAD5',
  icon_url: null,
}

it.each(['add', 'switch'] as const)(
  'blocks conflicting actions while %s is pending',
  async (action) => {
    const onConfirm = vi.fn()
    const onSwitchAccount = vi.fn()
    function Confirmation() {
      const [pending, setPending] = useState<'add' | 'switch' | null>(null)
      return (
        <SignInConfirmation
          accountName="Reader"
          app={app}
          continueHref="/chat/current-app"
          isSubmitting={pending === 'add'}
          isSwitchingAccount={pending === 'switch'}
          onConfirm={(choice) => {
            onConfirm(choice)
            setPending('add')
          }}
          onSwitchAccount={() => {
            onSwitchAccount()
            setPending('switch')
          }}
        />
      )
    }
    const screen = await render(<Confirmation />)
    const add = screen.getByRole('radio', { name: 'login.history.add' })
    const remove = screen.getByRole('radio', { name: 'login.history.delete' })
    await add.click()
    await screen
      .getByRole('button', {
        name:
          action === 'add' ? 'login.history.addAndContinue' : 'login.history.useDifferentAccount',
      })
      .click()

    await expect.element(add).toBeChecked()
    await expect.element(add).toBeDisabled()
    await expect.element(remove).toBeDisabled()
    await expect
      .element(screen.getByRole('button', { name: 'login.history.addAndContinue' }))
      .toBeDisabled()
    await expect
      .element(screen.getByRole('button', { name: 'login.history.useDifferentAccount' }))
      .toBeDisabled()
    await expect
      .element(screen.getByRole('button', { name: 'login.history.notNow' }))
      .toBeDisabled()
    await expect
      .element(screen.getByRole('link', { name: 'login.history.notNow' }))
      .not.toBeInTheDocument()

    if (action === 'add') {
      expect(onConfirm).toHaveBeenCalledExactlyOnceWith('add')
      expect(onSwitchAccount).not.toHaveBeenCalled()
    } else {
      expect(onSwitchAccount).toHaveBeenCalledOnce()
      expect(onConfirm).not.toHaveBeenCalled()
    }
  },
)
