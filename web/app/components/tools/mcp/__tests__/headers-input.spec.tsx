import type { HeaderItem } from '../headers-input'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { useState } from 'react'
import HeadersInput from '../headers-input'

it('adds and edits headers independently and removes the intended duplicate key', async () => {
  const user = userEvent.setup()
  const onChange = vi.fn()
  const Harness = () => {
    const [headers, setHeaders] = useState<HeaderItem[]>([])
    return (
      <HeadersInput
        headersItems={headers}
        onChange={(next) => {
          setHeaders(next)
          onChange(next)
        }}
      />
    )
  }
  render(<Harness />)
  expect(screen.getByText('tools.mcp.modal.noHeaders')).toBeInTheDocument()
  const add = () => screen.getByRole('button', { name: 'tools.mcp.modal.addHeader' })
  await user.click(add())
  await user.type(screen.getByRole('textbox', { name: 'tools.mcp.modal.headerKey' }), 'X-Header')
  await user.type(screen.getByRole('textbox', { name: 'tools.mcp.modal.headerValue' }), 'first')
  await user.click(add())
  await user.type(
    screen.getAllByRole('textbox', { name: 'tools.mcp.modal.headerKey' })[1]!,
    'X-Header',
  )
  await user.type(
    screen.getAllByRole('textbox', { name: 'tools.mcp.modal.headerValue' })[1]!,
    'second',
  )
  expect(onChange).toHaveBeenLastCalledWith([
    { id: expect.any(String), key: 'X-Header', value: 'first' },
    { id: expect.any(String), key: 'X-Header', value: 'second' },
  ])
  await user.click(screen.getByRole('button', { name: 'common.operation.delete X-Header 2' }))
  expect(onChange).toHaveBeenLastCalledWith([
    { id: expect.any(String), key: 'X-Header', value: 'first' },
  ])
  expect(screen.getByRole('textbox', { name: 'tools.mcp.modal.headerValue' })).toHaveValue('first')
  await user.click(screen.getByRole('button', { name: 'common.operation.delete X-Header 1' }))
  expect(onChange).toHaveBeenLastCalledWith([])
  expect(screen.getByText('tools.mcp.modal.noHeaders')).toBeInTheDocument()
})

it.each([
  { headersItems: [] },
  { headersItems: [{ id: '1', key: 'Authorization', value: 'stored-value' }] },
])('prevents modifications in readonly mode (%j)', async ({ headersItems }) => {
  const user = userEvent.setup()
  const onChange = vi.fn()
  render(<HeadersInput headersItems={headersItems} onChange={onChange} readonly />)
  expect(
    screen.queryByRole('button', { name: 'tools.mcp.modal.addHeader' }),
  ).not.toBeInTheDocument()
  expect(screen.queryByRole('button', { name: /common.operation.delete/ })).not.toBeInTheDocument()
  for (const input of screen.queryAllByRole('textbox')) {
    expect(input).toHaveAttribute('readonly')
    await user.type(input, 'changed')
  }
  expect(onChange).not.toHaveBeenCalled()
})
