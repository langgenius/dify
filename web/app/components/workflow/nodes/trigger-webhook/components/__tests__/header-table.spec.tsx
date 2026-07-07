import type { WebhookHeader } from '../../types'
import { fireEvent, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import HeaderTable from '../header-table'

describe('trigger-webhook/header-table', () => {
  it('updates header names and required flags through the real generic table', async () => {
    const user = userEvent.setup()
    const onChange = vi.fn()
    const headers: WebhookHeader[] = [{
      name: 'x-request-id',
      required: false,
    }]

    render(
      <HeaderTable
        headers={headers}
        onChange={onChange}
      />,
    )

    fireEvent.change(screen.getAllByRole('textbox')[0]!, { target: { value: 'Auth Token' } })
    expect(onChange).toHaveBeenLastCalledWith([{
      name: 'Auth_Token',
      required: false,
    }])

    onChange.mockClear()
    await user.click(screen.getAllByRole('checkbox')[0]!)

    expect(onChange).toHaveBeenCalledWith([{
      name: 'x-request-id',
      required: true,
    }])
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
