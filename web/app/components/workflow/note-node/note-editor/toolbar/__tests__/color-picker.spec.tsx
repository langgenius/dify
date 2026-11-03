import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { NoteTheme } from '../../../types'
import ColorPicker from '../color-picker'

describe('NoteEditor ColorPicker', () => {
  it('should open the palette and apply the selected theme', async () => {
    const user = userEvent.setup()
    const onThemeChange = vi.fn()
    render(<ColorPicker theme={NoteTheme.blue} onThemeChange={onThemeChange} />)

    await user.click(screen.getByRole('button'))

    const popup = screen.getByRole('dialog')

    const options = popup.querySelectorAll('.group.relative')

    await user.click(options[5] as Element)

    expect(onThemeChange).toHaveBeenCalledWith(NoteTheme.violet)

    await waitFor(() => {
      expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    })
  })
})
