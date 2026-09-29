import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { useState } from 'react'
import IdeaOutput from '../idea-output'

describe('IdeaOutput', () => {
  it('lets keyboard users expand, edit, and collapse the optional output', async () => {
    const user = userEvent.setup()
    function Editor() {
      const [value, setValue] = useState('Initial idea')
      return <IdeaOutput value={value} onChange={setValue} />
    }
    render(<Editor />)

    const trigger = screen.getByRole('button', { name: /generate\.idealOutput/ })
    expect(trigger).toHaveAttribute('aria-expanded', 'false')
    expect(screen.queryByRole('textbox')).not.toBeInTheDocument()

    await user.tab()
    expect(trigger).toHaveFocus()
    await user.keyboard('{Enter}')
    expect(trigger).toHaveAttribute('aria-expanded', 'true')

    const textarea = screen.getByRole('textbox', { name: /generate\.idealOutput/ })
    await user.tab()
    expect(textarea).toHaveFocus()
    await user.clear(textarea)
    await user.type(textarea, 'Updated idea')
    expect(textarea).toHaveValue('Updated idea')

    await user.tab({ shift: true })
    await user.keyboard(' ')
    expect(trigger).toHaveAttribute('aria-expanded', 'false')
    await waitFor(() => expect(screen.queryByRole('textbox')).not.toBeInTheDocument())
    expect(trigger).toHaveFocus()

    await user.keyboard('{Enter}')
    expect(screen.getByRole('textbox', { name: /generate\.idealOutput/ })).toHaveValue(
      'Updated idea',
    )
  })
})
