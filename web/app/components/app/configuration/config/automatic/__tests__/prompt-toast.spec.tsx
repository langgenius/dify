import { fireEvent, render, screen } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import PromptToast from '../prompt-toast'

describe('PromptToast', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('should render the optimization note and markdown message', () => {
    render(<PromptToast message="Hello **world**" />)

    expect(screen.getByText('appDebug.generate.optimizationNote')).toBeInTheDocument()
    expect(screen.getByTestId('markdown-body')).toBeInTheDocument()
  })

  it('should toggle folded state from the arrow trigger', () => {
    const { container } = render(<PromptToast message="Foldable message" />)
    const toggle = container.querySelector('.size-4.cursor-pointer')
    expect(toggle).not.toBeNull()

    fireEvent.click(toggle!)
    expect(screen.queryByTestId('markdown-body')).not.toBeInTheDocument()

    fireEvent.click(toggle!)
    expect(screen.getByTestId('markdown-body')).toBeInTheDocument()
  })
})
