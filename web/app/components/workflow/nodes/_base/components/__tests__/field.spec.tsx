import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import Field from '../field'

describe('Field', () => {
  it('names each explanation from its visible topic and keeps rich content in the dialog', async () => {
    const user = userEvent.setup()
    render(
      <>
        <Field
          title={<span>Retrieval settings</span>}
          tooltip={<p>Choose how documents are ranked.</p>}
        />
        <Field
          title={<span>Model settings</span>}
          tooltip={
            <p>
              Choose a model for this node. <a href="https://docs.dify.ai">Model documentation</a>
            </p>
          }
        />
      </>,
    )

    expect(screen.getByRole('button', { name: 'Retrieval settings' })).toBeInTheDocument()
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Model settings' }))

    const dialog = await screen.findByRole('dialog', { name: 'Model settings' })
    expect(within(dialog).getByText(/Choose a model for this node/)).toBeVisible()
    expect(within(dialog).getByRole('link', { name: 'Model documentation' })).toBeVisible()
    expect(screen.queryByRole('dialog', { name: 'Retrieval settings' })).not.toBeInTheDocument()
  })
})
