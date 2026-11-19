import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { PromptRole } from '@/models/debug'
import MessageTypeSelector from '../message-type-selector'

describe('MessageTypeSelector', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('should call onChange with selected type and close the list', async () => {
    const user = userEvent.setup()
    const onChange = vi.fn()
    render(<MessageTypeSelector value={PromptRole.assistant} onChange={onChange} />)

    await user.click(screen.getByText(PromptRole.assistant))
    await user.click(screen.getByText(PromptRole.user))

    expect(onChange).toHaveBeenCalledWith(PromptRole.user)
    expect(screen.queryByText(PromptRole.system)).toBeNull()
  })
})
