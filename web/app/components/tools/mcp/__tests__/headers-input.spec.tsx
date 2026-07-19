import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { useState } from 'react'
import { describe, expect, it, vi } from 'vitest'
import HeadersInput from '../headers-input'

const headers = [
  { id: 'header-1', key: 'Authorization', value: 'Bearer token' },
  { id: 'header-2', key: 'X-Workspace', value: 'workspace-1' },
]

function HeadersHarness({ onChange }: { onChange: (nextHeaders: typeof headers) => void }) {
  const [currentHeaders, setCurrentHeaders] = useState(headers)

  return (
    <HeadersInput
      headersItems={currentHeaders}
      onChange={(nextHeaders) => {
        setCurrentHeaders(nextHeaders)
        onChange(nextHeaders)
      }}
    />
  )
}

describe('HeadersInput', () => {
  it('adds the first editable header from the empty state', async () => {
    const onChange = vi.fn()
    const user = userEvent.setup()
    render(<HeadersInput headersItems={[]} onChange={onChange} />)

    expect(screen.getByText('tools.mcp.modal.noHeaders')).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'tools.mcp.modal.addHeader' }))

    expect(onChange).toHaveBeenCalledWith([
      expect.objectContaining({ id: expect.any(String), key: '', value: '' }),
    ])
  })

  it('updates and removes the selected header through named controls', async () => {
    const onChange = vi.fn()
    const user = userEvent.setup()
    render(<HeadersHarness onChange={onChange} />)

    await user.clear(screen.getByRole('textbox', { name: 'tools.mcp.modal.headerValue 2' }))
    await user.type(
      screen.getByRole('textbox', { name: 'tools.mcp.modal.headerValue 2' }),
      'workspace-2',
    )

    expect(onChange).toHaveBeenLastCalledWith([headers[0], { ...headers[1], value: 'workspace-2' }])

    await user.click(screen.getByRole('button', { name: 'common.operation.delete Authorization' }))

    expect(onChange).toHaveBeenLastCalledWith([{ ...headers[1], value: 'workspace-2' }])
  })
})
