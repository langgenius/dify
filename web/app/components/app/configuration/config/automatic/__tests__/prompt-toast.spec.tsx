import { render, screen } from '@testing-library/react'
import PromptToast from '../prompt-toast'

describe('PromptToast', () => {
  it('should render the note title and markdown message', () => {
    render(<PromptToast message="Prompt body" />)

    expect(screen.getByText('appGeneration.generate.optimizationNote')).toBeInTheDocument()
    expect(screen.getByTestId('markdown-body')).toBeInTheDocument()
  })
})
