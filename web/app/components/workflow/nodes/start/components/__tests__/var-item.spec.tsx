import type { InputVar } from '@/app/components/workflow/types'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { InputVarType } from '@/app/components/workflow/types'
import VarItem from '../var-item'

vi.mock('@/app/components/app/configuration/config-var/config-modal', () => ({
  default: ({ isShow, onClose }: { isShow: boolean; onClose: () => void }) =>
    isShow ? (
      <div role="dialog">
        edit-variable<button onClick={onClose}>Close editor</button>
      </div>
    ) : null,
}))

const createPayload = (overrides: Partial<InputVar> = {}): InputVar => ({
  label: 'Query',
  variable: 'query',
  type: InputVarType.textInput,
  required: false,
  ...overrides,
})

describe('StartVarItem', () => {
  it('opens the editor and removes the variable from its hover actions', async () => {
    const user = userEvent.setup()
    const handleRemove = vi.fn()
    render(<VarItem readonly={false} payload={createPayload()} onRemove={handleRemove} />)

    await user.hover(screen.getByText('query'))

    await user.click(screen.getByRole('button', { name: 'common.operation.edit' }))
    expect(screen.getByRole('dialog')).toHaveTextContent('edit-variable')

    await user.click(screen.getByRole('button', { name: 'Close editor' }))
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    await user.hover(screen.getByText('query'))
    await user.click(screen.getByRole('button', { name: 'common.operation.remove' }))
    expect(handleRemove).toHaveBeenCalledTimes(1)
  })
})
