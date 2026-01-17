import type { Credential } from '@/app/components/tools/types'
import { act, fireEvent, render, screen } from '@testing-library/react'
import { AuthHeaderPrefix, AuthType } from '@/app/components/tools/types'
import ConfigCredential from './config-credentials'

describe('ConfigCredential', () => {
  const baseCredential: Credential = {
    auth_type: AuthType.none,
  }
  const mockOnChange = vi.fn()
  const mockOnHide = vi.fn()

  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('renders and calls onHide when cancel is pressed', async () => {
    await act(async () => {
      render(
        <ConfigCredential
          credential={baseCredential}
          onChange={mockOnChange}
          onHide={mockOnHide}
        />,
      )
    })

    fireEvent.click(screen.getByText('common.operation.cancel'))

    expect(mockOnHide).toHaveBeenCalledTimes(1)
    expect(mockOnChange).not.toHaveBeenCalled()
  })

  it('allows selecting apiKeyHeader and submits the new credential', async () => {
    await act(async () => {
      render(
        <ConfigCredential
          credential={baseCredential}
          onChange={mockOnChange}
          onHide={mockOnHide}
        />,
      )
    })

    fireEvent.click(screen.getByText('tools.createTool.authMethod.types.api_key_header'))
    const headerInput = screen.getByPlaceholderText('tools.createTool.authMethod.types.apiKeyPlaceholder')
    const valueInput = screen.getByPlaceholderText('tools.createTool.authMethod.types.apiValuePlaceholder')
    fireEvent.change(headerInput, { target: { value: 'X-Auth' } })
    fireEvent.change(valueInput, { target: { value: 'sEcReT' } })
    fireEvent.click(screen.getByText('common.operation.save'))

    expect(mockOnChange).toHaveBeenCalledWith({
      auth_type: AuthType.apiKeyHeader,
      api_key_header: 'X-Auth',
      api_key_header_prefix: AuthHeaderPrefix.custom,
      api_key_value: 'sEcReT',
    })
    expect(mockOnHide).toHaveBeenCalled()
  })
})
