import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { NoteTheme } from '../../../types'
import ColorPicker from '../color-picker'

describe('NoteEditor ColorPicker', () => {
  it('should open the palette and apply the selected theme', async () => {
    const onThemeChange = vi.fn()
    render(<ColorPicker theme={NoteTheme.blue} onThemeChange={onThemeChange} />)

    fireEvent.click(screen.getByRole('button'))

    const popup = screen.getByRole('dialog')

    expect(popup).toBeInTheDocument()

    const options = popup.querySelectorAll('.group.relative')

    expect(options).toHaveLength(6)

    fireEvent.click(options[5] as Element)

    expect(onThemeChange).toHaveBeenCalledWith(NoteTheme.violet)

    await waitFor(() => {
      expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    })
  })
})
