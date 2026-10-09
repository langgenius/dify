import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { useState } from 'react'
import PromptEditorHeightResizeWrap from '../prompt-editor-height-resize-wrap'

function Editor({ hideResize = false }: { hideResize?: boolean }) {
  const [height, setHeight] = useState(200)
  return (
    <PromptEditorHeightResizeWrap
      height={height}
      minHeight={120}
      onHeightChange={setHeight}
      hideResize={hideResize}
    >
      <textarea aria-label="Prompt" />
    </PromptEditorHeightResizeWrap>
  )
}

describe('PromptEditorHeightResizeWrap', () => {
  it('supports keyboard height changes without intercepting editor keys or imposing a maximum', async () => {
    const user = userEvent.setup()
    render(<Editor />)
    const handle = screen.getByRole('button', { name: 'common.resize.editor' })
    const editor = document.getElementById(handle.getAttribute('aria-controls')!)!
    await user.tab()
    await user.keyboard('{ArrowDown}')
    expect(editor).toHaveStyle({ height: '200px' })
    await user.tab()
    expect(handle).toHaveFocus()
    await user.keyboard('{ArrowDown}{Shift>}{ArrowDown}{/Shift}')
    expect(editor).toHaveStyle({ height: '240px' })
    await user.keyboard('{ArrowUp}{End}')
    expect(editor).toHaveStyle({ height: '232px' })
    await user.keyboard('{Home}{ArrowUp}')
    expect(editor).toHaveStyle({ height: '120px' })
    await user.keyboard('{ArrowDown}{Enter}')
    expect(editor).toHaveStyle({ height: '120px' })
    await user.tab({ shift: true })
    expect(screen.getByRole('textbox', { name: 'Prompt' })).toHaveFocus()
  })

  it.each([true, false])(
    'continues resizing by keyboard after a mouse drag (click on release: %s)',
    async (clickOnRelease) => {
      const user = userEvent.setup()
      render(<Editor />)
      const handle = screen.getByRole('button', { name: 'common.resize.editor' })
      const editor = document.getElementById(handle.getAttribute('aria-controls')!)!
      fireEvent.mouseDown(handle, { clientY: 200 })
      fireEvent.mouseMove(document, { clientY: 260 })
      await waitFor(() => expect(editor).toHaveStyle({ height: '260px' }))
      fireEvent.mouseUp(document)
      if (clickOnRelease) fireEvent.click(handle, { detail: 1 })
      expect(editor).toHaveStyle({ height: '260px' })
      await user.tab()
      await user.tab()
      await user.keyboard('{ArrowDown}')
      expect(editor).toHaveStyle({ height: '268px' })
      await user.keyboard('{Enter}')
      expect(editor).toHaveStyle({ height: '120px' })
    },
  )

  it('does not expose a resize control when resizing is hidden', () => {
    render(<Editor hideResize />)
    expect(screen.queryByRole('button', { name: 'common.resize.editor' })).not.toBeInTheDocument()
  })
})
