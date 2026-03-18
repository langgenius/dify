import { fireEvent, render, waitFor } from '@testing-library/react'
import { NoteTheme } from '../../../types'
import ColorPicker, { COLOR_LIST } from '../color-picker'

describe('NoteEditor ColorPicker', () => {
  it('should open the palette and apply the selected theme', async () => {
    const onThemeChange = vi.fn()
    const { container } = render(
      <ColorPicker theme={NoteTheme.blue} onThemeChange={onThemeChange} />,
    )

    const trigger = container.querySelector('[data-state="closed"]') as HTMLElement

    fireEvent.click(trigger)

    const popup = document.body.querySelector('[role="tooltip"]')

    expect(popup).toBeInTheDocument()

    const options = popup?.querySelectorAll('.group.relative')

    expect(options).toHaveLength(COLOR_LIST.length)

    fireEvent.click(options?.[COLOR_LIST.length - 1] as Element)

    expect(onThemeChange).toHaveBeenCalledWith(NoteTheme.violet)

    await waitFor(() => {
      expect(document.body.querySelector('[role="tooltip"]')).not.toBeInTheDocument()
    })
  })
})
