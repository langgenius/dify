import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it } from 'vite-plus/test'
import CreateWorkspace from '..'

const nameLabel = 'common.workspace.create.name'
const continueLabel = 'common.workspace.create.continue'
const requiredMessage = 'common.workspace.create.nameRequired'

describe('CreateWorkspace', () => {
  it.each(['', '   '])(
    'rejects an empty workspace name (%j) and focuses the field',
    async (name) => {
      const user = userEvent.setup()
      render(<CreateWorkspace />)
      const input = screen.getByRole('textbox', { name: nameLabel })

      if (name) await user.type(input, name)
      await user.click(screen.getByRole('button', { name: continueLabel }))

      expect(await screen.findByText(requiredMessage)).toBeInTheDocument()
      expect(input).toHaveAttribute('aria-invalid', 'true')
      await waitFor(() => expect(input).toHaveFocus())
    },
  )

  it('clears a required error after correcting the name and keeps the entered name', async () => {
    const user = userEvent.setup()
    render(<CreateWorkspace />)
    const input = screen.getByRole('textbox', { name: nameLabel })

    await user.click(screen.getByRole('button', { name: continueLabel }))
    expect(await screen.findByText(requiredMessage)).toBeInTheDocument()
    await user.type(input, 'Product team')
    await user.click(screen.getByRole('button', { name: continueLabel }))

    await waitFor(() => expect(screen.queryByText(requiredMessage)).not.toBeInTheDocument())
    expect(input).toHaveValue('Product team')
    expect(
      screen.getByRole('heading', { name: 'common.workspace.create.title' }),
    ).toBeInTheDocument()
  })

  it('validates the name when submitting with Enter', async () => {
    const user = userEvent.setup()
    render(<CreateWorkspace />)
    const input = screen.getByRole('textbox', { name: nameLabel })

    await user.click(input)
    await user.keyboard('{Enter}')

    expect(await screen.findByText(requiredMessage)).toBeInTheDocument()
    expect(input).toHaveAttribute('aria-invalid', 'true')
  })

  it('links back to My apps', () => {
    render(<CreateWorkspace />)

    expect(
      screen.getByRole('link', { name: 'common.workspace.create.backToMyApps' }),
    ).toHaveAttribute('href', '/my-apps')
  })
})
