import type { WebhookParameter } from '../../types'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { useState } from 'react'
import { VarType } from '@/app/components/workflow/types'
import ParameterTable from '../parameter-table'

describe('trigger-webhook/parameter-table', () => {
  it('updates parameter types and required flags for json payloads', async () => {
    const user = userEvent.setup()
    const onChange = vi.fn()
    const parameters: WebhookParameter[] = [
      {
        name: 'page',
        type: VarType.string,
        required: false,
      },
    ]

    function Editor() {
      const [value, setValue] = useState(parameters)
      return (
        <ParameterTable
          title="Parameters"
          parameters={value}
          onChange={(next) => {
            setValue(next)
            onChange(next)
          }}
          contentType="application/json"
        />
      )
    }
    render(<Editor />)
    await user.click(screen.getAllByRole('combobox')[0]!)
    await user.click(await screen.findByRole('option', { name: 'Number' }))

    await waitFor(() => {
      expect(onChange).toHaveBeenCalledWith([
        {
          name: 'page',
          type: VarType.number,
          required: false,
        },
      ])
    })

    onChange.mockClear()
    await user.click(screen.getAllByRole('checkbox')[0]!)

    expect(onChange).toHaveBeenCalledWith([
      {
        name: 'page',
        type: VarType.number,
        required: true,
      },
    ])
  })

  it('forces plain-text bodies to a single string parameter', async () => {
    const user = userEvent.setup()
    const onChange = vi.fn()

    render(
      <ParameterTable
        title="Body"
        parameters={[
          {
            name: 'message',
            type: VarType.number,
            required: false,
          },
          { name: 'extra', type: VarType.string, required: false },
        ]}
        onChange={onChange}
        contentType="text/plain"
      />,
    )

    await user.click(screen.getAllByRole('checkbox')[0]!)

    expect(onChange).toHaveBeenCalledWith([
      {
        name: 'message',
        type: VarType.string,
        required: true,
      },
    ])
  })
})
