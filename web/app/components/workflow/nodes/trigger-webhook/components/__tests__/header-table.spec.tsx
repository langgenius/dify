import type { WebhookHeader } from '../../types'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { useState } from 'react'
import HeaderTable from '../header-table'

describe('trigger-webhook/header-table', () => {
  it('updates header names and required flags through the real generic table', async () => {
    const user = userEvent.setup()
    const onChange = vi.fn()
    const headers: WebhookHeader[] = [
      {
        name: 'x-request-id',
        required: false,
      },
    ]

    function Editor() {
      const [value, setValue] = useState(headers)
      return (
        <HeaderTable
          headers={value}
          onChange={(next) => {
            setValue(next)
            onChange(next)
          }}
        />
      )
    }
    render(<Editor />)
    const input = screen.getByDisplayValue('x-request-id')
    await user.clear(input)
    await user.type(input, 'Auth Token')
    expect(onChange).toHaveBeenLastCalledWith([{ name: 'Auth_Token', required: false }])

    await user.click(
      screen.getAllByRole('checkbox', {
        name: 'workflowIntegrations.nodes.triggerWebhook.required',
      })[0]!,
    )
    expect(onChange).toHaveBeenLastCalledWith([{ name: 'Auth_Token', required: true }])
  })

  it('renders readonly rows without the trailing editable row', () => {
    render(
      <HeaderTable
        readonly
        headers={[{ name: 'authorization', required: true }]}
        onChange={vi.fn()}
      />,
    )

    expect(screen.getByDisplayValue('authorization'))!.toBeDisabled()
    expect(screen.getAllByRole('checkbox')).toHaveLength(1)
  })
})
