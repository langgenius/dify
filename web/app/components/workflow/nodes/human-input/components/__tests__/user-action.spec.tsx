import type { UserAction } from '../../types'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { useState } from 'react'
import { UserActionButtonType } from '../../types'
import UserActionItem from '../user-action'

const mockNotify = vi.hoisted(() => vi.fn())
vi.mock('@/app/notifications', () => ({ toast: { error: mockNotify } }))

const prefix = 'workflowHumanInput.nodes.humanInput.userActions'
const action: UserAction = {
  id: 'approve',
  title: 'Approve',
  button_style: UserActionButtonType.Primary,
}

function Harness({
  onChange,
  onDelete = vi.fn(),
  readonly = false,
}: {
  onChange: (action: UserAction) => void
  onDelete?: (id: string) => void
  readonly?: boolean
}) {
  const [data, setData] = useState(action)
  return (
    <UserActionItem
      data={data}
      onChange={(next) => {
        setData(next)
        onChange(next)
      }}
      onDelete={onDelete}
      readonly={readonly}
    />
  )
}

describe('UserActionItem', () => {
  it('sanitizes pasted identifiers, rejects invalid ones, and preserves edits when changing the title', async () => {
    const user = userEvent.setup()
    const onChange = vi.fn()
    render(<Harness onChange={onChange} />)
    const identifier = screen.getByRole('textbox', { name: `${prefix}.actionNamePlaceholder` })
    await user.clear(identifier)
    await user.paste('Approve action')
    expect(identifier).toHaveValue('Approve_action')

    await user.clear(identifier)
    onChange.mockClear()
    await user.paste('1invalid')
    expect(onChange).not.toHaveBeenCalled()
    expect(identifier).toHaveValue('')
    expect(mockNotify).toHaveBeenLastCalledWith(`${prefix}.actionIdFormatTip`)

    await user.paste('averyveryveryverylongidentifier')
    expect(identifier).toHaveValue('averyveryveryverylon')
    expect(mockNotify).toHaveBeenLastCalledWith(`${prefix}.actionIdTooLong:{"maxLength":20}`)

    const title = screen.getByRole('textbox', { name: `${prefix}.buttonTextPlaceholder` })
    await user.clear(title)
    await user.paste('Approve request')
    expect(onChange).toHaveBeenLastCalledWith({
      ...action,
      id: 'averyveryveryverylon',
      title: 'Approve request',
    })
  })

  it('keeps the edited identifier through style changes and deletes that action', async () => {
    const user = userEvent.setup()
    const onChange = vi.fn()
    const onDelete = vi.fn()
    const { rerender } = render(<Harness onChange={onChange} onDelete={onDelete} />)
    const identifier = screen.getByRole('textbox', { name: `${prefix}.actionNamePlaceholder` })
    await user.clear(identifier)
    expect(identifier).toHaveValue('')
    await user.paste('accept')
    await user.click(screen.getByRole('button', { name: `Approve: ${prefix}.chooseStyle` }))
    await user.click(
      await screen.findByRole('radio', { name: `Approve, ${prefix}.buttonStyle.ghost` }),
    )
    expect(onChange).toHaveBeenLastCalledWith({
      ...action,
      id: 'accept',
      button_style: UserActionButtonType.Ghost,
    })
    await user.keyboard('{Escape}')
    await user.click(screen.getByRole('button', { name: 'common.operation.delete' }))
    expect(onDelete).toHaveBeenCalledWith('accept')

    rerender(<Harness onChange={onChange} onDelete={onDelete} readonly />)
    expect(identifier).toBeDisabled()
    expect(screen.getByRole('textbox', { name: `${prefix}.buttonTextPlaceholder` })).toBeDisabled()
    expect(screen.getByRole('button', { name: `Approve: ${prefix}.chooseStyle` })).toBeDisabled()
    expect(
      screen.queryByRole('button', { name: 'common.operation.delete' }),
    ).not.toBeInTheDocument()
  })
})
