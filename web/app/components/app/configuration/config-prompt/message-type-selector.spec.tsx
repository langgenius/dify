import React from 'react'
import { fireEvent, render, screen } from '@testing-library/react'
import MessageTypeSelector from './message-type-selector'
import { PromptRole } from '@/models/debug'

describe('MessageTypeSelector', () => {
  beforeEach(() => {
    jest.clearAllMocks()
  })

  it('should render current value and keep options hidden by default', () => {
    render(<MessageTypeSelector value={PromptRole.user} onChange={jest.fn()} />)

    expect(screen.getByText(PromptRole.user)).toBeInTheDocument()
    expect(screen.queryByText(PromptRole.system)).toBeNull()
  })

  it('should toggle option list when clicking the selector', () => {
    render(<MessageTypeSelector value={PromptRole.system} onChange={jest.fn()} />)

    fireEvent.click(screen.getByText(PromptRole.system))

    expect(screen.getByText(PromptRole.user)).toBeInTheDocument()
    expect(screen.getByText(PromptRole.assistant)).toBeInTheDocument()
  })

  it('should call onChange with selected type and close the list', () => {
    const onChange = jest.fn()
    render(<MessageTypeSelector value={PromptRole.assistant} onChange={onChange} />)

    fireEvent.click(screen.getByText(PromptRole.assistant))
    fireEvent.click(screen.getByText(PromptRole.user))

    expect(onChange).toHaveBeenCalledWith(PromptRole.user)
    expect(screen.queryByText(PromptRole.system)).toBeNull()
  })
})
