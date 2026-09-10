import type { ReactNode } from 'react'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { createPortal } from 'react-dom'
import { Infotip } from '../index'

function ClickBoundary({ children, onClick }: { children: ReactNode; onClick: () => void }) {
  return (
    <button type="button" aria-label="Parent action" onClick={onClick}>
      {createPortal(children, document.body)}
    </button>
  )
}

describe('Infotip', () => {
  it('should open with keyboard activation', async () => {
    const user = userEvent.setup()
    render(<Infotip aria-label="Rate limits">Rate limit details</Infotip>)

    screen.getByRole('button', { name: 'Rate limits' }).focus()
    await user.keyboard('{Enter}')

    expect(await screen.findByRole('dialog')).toHaveTextContent('Rate limit details')
  })

  it('should close the dialog with Escape', async () => {
    const user = userEvent.setup()
    render(<Infotip aria-label="Rate limits">Rate limit details</Infotip>)

    await user.click(screen.getByRole('button', { name: 'Rate limits' }))
    expect(await screen.findByRole('dialog')).toBeInTheDocument()

    await user.keyboard('{Escape}')

    await waitFor(() => {
      expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    })
  })

  it('should not propagate trigger clicks', async () => {
    const user = userEvent.setup()
    const parentClick = vi.fn()
    render(
      <ClickBoundary onClick={parentClick}>
        <Infotip aria-label="Rate limits">Rate limit details</Infotip>
      </ClickBoundary>,
    )

    await user.click(screen.getByRole('button', { name: 'Rate limits' }))

    expect(parentClick).not.toHaveBeenCalled()
  })
})
