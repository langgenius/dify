import { render, screen } from '@testing-library/react'
import Operate from './Operate'

describe('Operate', () => {
  it('renders cancel and save when editing', () => {
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

  it('shows add key prompt when closed', () => {
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

  it('shows invalid state indicator and edit prompt when status is fail', () => {
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

  it('shows edit prompt without error text when status is success', () => {
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

  it('shows no actions for unsupported status', () => {
    render(
      <Operate
        isOpen={false}
        status={'unknown' as never}
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
