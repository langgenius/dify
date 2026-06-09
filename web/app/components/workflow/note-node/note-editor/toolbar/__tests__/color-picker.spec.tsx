import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { NoteTheme } from '../../../types'
import ColorPicker from '../color-picker'

vi.mock('@langgenius/dify-ui/popover', () => import('@/__mocks__/base-ui-popover'))

describe('NoteEditor ColorPicker', () => {
  it('should open the palette and apply the selected theme', async () => {
    const onThemeChange = vi.fn()
    render(
      <ColorPicker theme={NoteTheme.blue} onThemeChange={onThemeChange} />,
    )

    fireEvent.click(screen.getByTestId('popover-trigger'))

    const popup = screen.getByTestId('popover-content')

    expect(popup).toBeInTheDocument()

    const options = popup.querySelectorAll('.group.relative')

    expect(options).toHaveLength(6)

    fireEvent.click(options[5] as Element)

    expect(onThemeChange).toHaveBeenCalledWith(NoteTheme.violet)

    await waitFor(() => {
      expect(screen.queryByTestId('popover-content')).not.toBeInTheDocument()
    })
  })
})
