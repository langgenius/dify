import { render, screen, waitFor } from '@testing-library/react'
import { EventEmitterContextProvider } from '@/context/event-emitter-provider'
import PromptEditor from '../index'

describe('PromptEditor controlled state', () => {
  it('synchronizes external text and editability without replacing the editor', async () => {
    const { rerender } = render(<PromptEditor aria-label="Prompt" value="First prompt" />, {
      wrapper: EventEmitterContextProvider,
    })
    const editor = screen.getByRole('textbox', { name: 'Prompt' })
    expect(editor).toHaveTextContent('First prompt')
    expect(editor).toHaveAttribute('contenteditable', 'true')

    rerender(<PromptEditor aria-label="Prompt" value="Updated prompt" editable={false} />)

    await waitFor(() => expect(editor).toHaveTextContent('Updated prompt'))
    expect(screen.getByRole('textbox', { name: 'Prompt' })).toBe(editor)
    expect(editor).toHaveAttribute('contenteditable', 'false')

    rerender(<PromptEditor aria-label="Prompt" value="" placeholder="Write a prompt" />)

    await waitFor(() => expect(editor).toHaveTextContent(''))
    expect(editor).toHaveAttribute('contenteditable', 'true')
    expect(screen.getByText('Write a prompt')).toBeVisible()
  })
})
