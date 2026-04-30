import { fireEvent, render, screen } from '@testing-library/react'
import PromptToast from '../prompt-toast'

describe('PromptToast', () => {
  it('should render the note title and markdown message', () => {
    render(<PromptToast message="Prompt body" />)

    expect(screen.getByText('appDebug.generate.optimizationNote')).toBeInTheDocument()
    expect(screen.getByTestId('markdown-body')).toBeInTheDocument()
  })

  it('should collapse and expand the markdown content', () => {
    const { container } = render(<PromptToast message="Prompt body" />)

    const toggle = container.querySelector('.cursor-pointer') as HTMLElement
    fireEvent.click(toggle)
    expect(screen.queryByTestId('markdown-body')).not.toBeInTheDocument()

    fireEvent.click(toggle)
    expect(screen.getByTestId('markdown-body')).toBeInTheDocument()
  })
})
