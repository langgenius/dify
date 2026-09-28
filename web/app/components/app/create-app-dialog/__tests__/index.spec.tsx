import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import CreateAppTemplateDialog from '../index'

vi.mock('../app-list', () => ({
  default: function MockAppList({ onClose }: { onClose: () => void }) {
    return (
      <div role="region" aria-label="App list">
        <button type="button" onClick={onClose}>
          Use template
        </button>
      </div>
    )
  },
}))

describe('CreateAppTemplateDialog', () => {
  it('renders the template list only when open', () => {
    const { rerender } = render(<CreateAppTemplateDialog show={false} onClose={vi.fn()} />)
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()

    rerender(<CreateAppTemplateDialog show onClose={vi.fn()} />)
    expect(screen.getByRole('dialog')).toBeInTheDocument()
    expect(screen.getByRole('region', { name: 'App list' })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Create from Blank' })).not.toBeInTheDocument()
  })

  it('closes when a template is used', async () => {
    const user = userEvent.setup()
    const onClose = vi.fn()
    render(<CreateAppTemplateDialog show onClose={onClose} />)

    await user.click(screen.getByRole('button', { name: 'Use template' }))
    expect(onClose).toHaveBeenCalledOnce()
  })
})
