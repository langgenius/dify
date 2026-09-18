import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import VarItem from '../var-item'

describe('VarItem', () => {
  it('should reach and activate editing with the keyboard without hovering', async () => {
    const user = userEvent.setup()
    const onEdit = vi.fn()
    const onRemove = vi.fn()
    render(
      <VarItem
        canDrag
        name="api_key"
        label="API Key"
        required
        type="string"
        onEdit={onEdit}
        onRemove={onRemove}
      />,
    )

    expect(screen.getByTitle('api_key · API Key')).toBeInTheDocument()
    expect(screen.getByText('required')).toBeInTheDocument()

    await user.tab()
    expect(screen.getByRole('button', { name: 'api_key' })).toHaveFocus()
    await user.tab()
    expect(screen.getByRole('button', { name: 'common.operation.edit' })).toHaveFocus()
    await user.keyboard('{Enter}')

    expect(onEdit).toHaveBeenCalledTimes(1)
  })

  it('should reach and activate deletion with the keyboard without hovering', async () => {
    const user = userEvent.setup()
    const onRemove = vi.fn()
    render(
      <VarItem
        name="region"
        label="Region"
        required={false}
        type="select"
        onEdit={vi.fn()}
        onRemove={onRemove}
      />,
    )

    await user.tab()
    await user.tab()
    expect(screen.getByRole('button', { name: 'common.operation.delete' })).toHaveFocus()
    await user.keyboard(' ')

    expect(onRemove).toHaveBeenCalledTimes(1)
  })
  it('does not offer mutation actions for a readonly variable', () => {
    render(
      <VarItem
        readonly
        name="region"
        label="Region"
        required={false}
        type="string"
        onEdit={vi.fn()}
        onRemove={vi.fn()}
      />,
    )
    expect(screen.queryByRole('button', { name: 'common.operation.edit' })).not.toBeInTheDocument()
    expect(
      screen.queryByRole('button', { name: 'common.operation.delete' }),
    ).not.toBeInTheDocument()
  })
})
