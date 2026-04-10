import type { WebhookParameter } from '../../types'
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { VarType } from '@/app/components/workflow/types'
import ParameterTable from '../parameter-table'

const selectOption = async (triggerName: string, optionName: string) => {
  await act(async () => {
    fireEvent.click(screen.getAllByRole('button', { name: triggerName })[0])
  })

  await act(async () => {
    fireEvent.click(await screen.findByRole('option', { name: optionName }))
  })
}

describe('trigger-webhook/parameter-table', () => {
  it('updates parameter types and required flags for json payloads', async () => {
    const user = userEvent.setup()
    const onChange = vi.fn()
    const parameters: WebhookParameter[] = [{
      name: 'page',
      type: VarType.string,
      required: false,
    }]

    render(
      <ParameterTable
        title="Parameters"
        parameters={parameters}
        onChange={onChange}
        contentType="application/json"
      />,
    )

    await selectOption('String', 'Number')

    await waitFor(() => {
      expect(onChange).toHaveBeenCalledWith([{
        name: 'page',
        type: VarType.number,
        required: false,
      }])
    })

    onChange.mockClear()
    await user.click(screen.getAllByRole('checkbox')[0])

    expect(onChange).toHaveBeenCalledWith([{
      name: 'page',
      type: VarType.string,
      required: true,
    }])
  })

  it('forces plain-text bodies to a single string parameter', async () => {
    const user = userEvent.setup()
    const onChange = vi.fn()

    render(
      <ParameterTable
        title="Body"
        parameters={[{
          name: 'message',
          type: VarType.number,
          required: false,
        }]}
        onChange={onChange}
        contentType="text/plain"
      />,
    )

    await user.click(screen.getAllByRole('checkbox')[0])

    expect(onChange).toHaveBeenCalledWith([{
      name: 'message',
      type: VarType.string,
      required: true,
    }])
  })
})
