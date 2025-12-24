import { fireEvent, render, screen } from '@testing-library/react'
import * as React from 'react'
import { PromptRole } from '@/models/debug'
import MessageTypeSelector from './message-type-selector'

describe('MessageTypeSelector', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('should render current value and keep options hidden by default', () => {
    render(<MessageTypeSelector value={PromptRole.user} onChange={vi.fn()} />)

    expect(screen.getByText(PromptRole.user)).toBeInTheDocument()
    expect(screen.queryByText(PromptRole.system)).toBeNull()
  })

  it('should toggle option list when clicking the selector', () => {
    render(<MessageTypeSelector value={PromptRole.system} onChange={vi.fn()} />)

    fireEvent.click(screen.getByText(PromptRole.system))

    expect(screen.getByText(PromptRole.user)).toBeInTheDocument()
    expect(screen.getByText(PromptRole.assistant)).toBeInTheDocument()
  })

  it('should call onChange with selected type and close the list', () => {
    const onChange = vi.fn()
    render(<MessageTypeSelector value={PromptRole.assistant} onChange={onChange} />)

    fireEvent.click(screen.getByText(PromptRole.assistant))
    fireEvent.click(screen.getByText(PromptRole.user))

    expect(onChange).toHaveBeenCalledWith(PromptRole.user)
    expect(screen.queryByText(PromptRole.system)).toBeNull()
  })
})
