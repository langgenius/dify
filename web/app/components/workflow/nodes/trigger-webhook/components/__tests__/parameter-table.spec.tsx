import type { WebhookParameter } from '../../types'
import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { VarType } from '@/app/components/workflow/types'
import ParameterTable from '../parameter-table'

const selectOption = async ({
  rowKey,
  triggerName,
}: {
  rowKey: string
  triggerName: string
}) => {
  const user = userEvent.setup()
  const rowInput = screen.getByDisplayValue(rowKey)
  const row = rowInput.closest('[style*="min-height"]')
  if (!(row instanceof HTMLElement))
    throw new Error('Failed to locate parameter table row')

  const selectButton = within(row).getByRole('button', { name: triggerName })
  await user.click(selectButton)
  await user.keyboard('{ArrowDown}')
  await user.keyboard('{Enter}')
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

    await selectOption({
      rowKey: 'page',
      triggerName: 'String',
    })

    await waitFor(() => {
      expect(onChange).toHaveBeenCalledWith([{
        name: 'page',
        type: VarType.number,
        required: false,
      }])
    })

    onChange.mockClear()
    await user.click(screen.getAllByRole('checkbox')[0]!)

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

    await user.click(screen.getAllByRole('checkbox')[0]!)

    expect(onChange).toHaveBeenCalledWith([{
      name: 'message',
      type: VarType.string,
      required: true,
    }])
  })
})
