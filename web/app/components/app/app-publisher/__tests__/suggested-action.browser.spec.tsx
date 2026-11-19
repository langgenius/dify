import { useState } from 'react'
import { userEvent } from 'vite-plus/test/browser'
import { render } from 'vitest-browser-react'
import SuggestedAction from '../suggested-action'

it('reveals supporting copy on native keyboard focus and exposes a separate trailing action', async () => {
  const screen = await render(
    <div style={{ width: 400 }}>
      <button>Before actions</button>
      <SuggestedAction
        link="/app/app-1/deploy"
        description="Push versions to environments"
        actionButton={{
          ariaLabel: 'Configure action',
          icon: <span aria-hidden>config</span>,
          onClick: vi.fn(),
        }}
      >
        Deploy
      </SuggestedAction>
      <button>After actions</button>
    </div>,
  )
  const link = screen.getByRole('link', { name: 'Deploy' })
  const copy = screen.getByText('Push versions to environments')
  await expect.element(link).toHaveAttribute('href', '/app/app-1/deploy')
  await expect.element(link).toHaveAttribute('target', '_blank')
  await expect.element(link).toHaveAttribute('rel', 'noreferrer')
  await screen.getByRole('button', { name: 'Before actions' }).click()
  await userEvent.tab()
  await expect.element(link).toHaveFocus()
  await expect.poll(() => copy.element().checkVisibility({ opacityProperty: true })).toBe(true)
  await expect.element(link).toHaveAccessibleDescription('Push versions to environments')
  await userEvent.tab()
  const action = screen.getByRole('button', { name: 'Configure action' })
  await expect.element(action).toHaveFocus()
  const rect = action.element().getBoundingClientRect()
  expect(
    action
      .element()
      .contains(document.elementFromPoint(rect.x + rect.width / 2, rect.y + rect.height / 2)),
  ).toBe(true)
  await userEvent.tab()
  await expect.element(screen.getByRole('button', { name: 'After actions' })).toHaveFocus()
})

it('skips both unavailable actions in the native tab order and exposes no navigable link', async () => {
  const screen = await render(
    <>
      <button>Before actions</button>
      <SuggestedAction
        link="https://example.com/app"
        disabled
        actionButton={{ ariaLabel: 'Configure action', icon: <span />, onClick: vi.fn() }}
      >
        Open web app
      </SuggestedAction>
      <button>After actions</button>
    </>,
  )
  await expect.element(screen.getByRole('button', { name: 'Open web app' })).toBeDisabled()
  await expect.element(screen.getByRole('button', { name: 'Configure action' })).toBeDisabled()
  await expect.element(screen.getByRole('link', { name: 'Open web app' })).not.toBeInTheDocument()
  await screen.getByRole('button', { name: 'Before actions' }).click()
  await userEvent.tab()
  await expect.element(screen.getByRole('button', { name: 'After actions' })).toHaveFocus()
})

it('keeps an explained unavailable action focusable without activating it', async () => {
  function Actions() {
    const [activated, setActivated] = useState(false)
    return (
      <>
        <button>Before actions</button>
        <SuggestedAction disabled focusableWhenDisabled onClick={() => setActivated(true)}>
          Unavailable action
        </SuggestedAction>
        {activated && <p>Action activated</p>}
        <button>After actions</button>
      </>
    )
  }
  const screen = await render(<Actions />)
  await screen.getByRole('button', { name: 'Before actions' }).click()
  await userEvent.tab()
  const action = screen.getByRole('button', { name: 'Unavailable action' })
  await expect.element(action).toHaveFocus()
  await expect.element(action).toHaveAttribute('aria-disabled', 'true')
  await userEvent.keyboard('{Enter}')
  await expect.element(action).toHaveFocus()
  await userEvent.keyboard(' ')
  await expect.element(screen.getByText('Action activated')).not.toBeInTheDocument()
  await userEvent.tab()
  await expect.element(screen.getByRole('button', { name: 'After actions' })).toHaveFocus()
})
