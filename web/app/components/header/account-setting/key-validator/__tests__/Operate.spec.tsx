import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import Operate from '../Operate'

describe('Operate', () => {
  it('should render cancel and save when editing is open', () => {
    render(
      <Operate
        isOpen
        status="add"
        onAdd={vi.fn()}
        onCancel={vi.fn()}
        onEdit={vi.fn()}
        onSave={vi.fn()}
      />,
    )

    expect(screen.getByText('common.operation.cancel')).toBeInTheDocument()
    expect(screen.getByText('common.operation.save')).toBeInTheDocument()
  })

  it('should show add-key prompt when closed', () => {
    render(
      <Operate
        isOpen={false}
        status="add"
        onAdd={vi.fn()}
        onCancel={vi.fn()}
        onEdit={vi.fn()}
        onSave={vi.fn()}
      />,
    )

    expect(screen.getByText('common.provider.addKey')).toBeInTheDocument()
  })

  it('should show invalid state and edit prompt when status is fail', () => {
    render(
      <Operate
        isOpen={false}
        status="fail"
        onAdd={vi.fn()}
        onCancel={vi.fn()}
        onEdit={vi.fn()}
        onSave={vi.fn()}
      />,
    )

    expect(screen.getByText('common.provider.invalidApiKey')).toBeInTheDocument()
    expect(screen.getByText('common.provider.editKey')).toBeInTheDocument()
  })

  it('should show edit prompt without error text when status is success', () => {
    render(
      <Operate
        isOpen={false}
        status="success"
        onAdd={vi.fn()}
        onCancel={vi.fn()}
        onEdit={vi.fn()}
        onSave={vi.fn()}
      />,
    )

    expect(screen.getByText('common.provider.editKey')).toBeInTheDocument()
    expect(screen.queryByText('common.provider.invalidApiKey')).toBeNull()
  })

  it('should not call onAdd when disabled', async () => {
    const user = userEvent.setup()
    const onAdd = vi.fn()
    render(
      <Operate
        isOpen={false}
        status="add"
        disabled
        onAdd={onAdd}
        onCancel={vi.fn()}
        onEdit={vi.fn()}
        onSave={vi.fn()}
      />,
    )
    await user.click(screen.getByText('common.provider.addKey'))
    expect(onAdd).not.toHaveBeenCalled()
  })

  it('should show no actions when status is unsupported', () => {
    render(
      <Operate
        isOpen={false}
        // @ts-expect-error intentional invalid status for runtime fallback coverage
        status="unknown"
        onAdd={vi.fn()}
        onCancel={vi.fn()}
        onEdit={vi.fn()}
        onSave={vi.fn()}
      />,
    )

    expect(screen.queryByText('common.provider.addKey')).toBeNull()
    expect(screen.queryByText('common.provider.editKey')).toBeNull()
  })
})
