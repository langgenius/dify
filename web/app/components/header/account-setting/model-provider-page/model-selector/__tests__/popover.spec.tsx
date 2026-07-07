import { fireEvent, render, screen } from '@testing-library/react'
import ModelSelector from '../index'

vi.mock('../../hooks', () => ({
  useCurrentProviderAndModel: () => ({
    currentProvider: undefined,
    currentModel: undefined,
  }),
}))

vi.mock('../model-selector-trigger', () => ({
  default: ({ open, readonly }: { open: boolean, readonly?: boolean }) => (
    <span>
      {open ? 'open' : 'closed'}
      -
      {readonly ? 'readonly' : 'editable'}
    </span>
  ),
}))

vi.mock('../popup', () => ({
  default: ({ onHide }: { onHide: () => void }) => (
    <div data-testid="popup">
      <button type="button" onClick={onHide}>hide-popup</button>
    </div>
  ),
}))

describe('ModelSelector combobox branches', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('should open and close through combobox trigger when editable', () => {
    const onHide = vi.fn()
    render(<ModelSelector modelList={[]} onHide={onHide} />)

    fireEvent.click(screen.getByRole('combobox'))

    expect(screen.getByText('open-editable')).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: 'hide-popup' }))

    expect(screen.getByText('closed-editable')).toBeInTheDocument()
    expect(onHide).toHaveBeenCalledTimes(1)
  })

  it('should ignore combobox open requests when readonly', () => {
    render(<ModelSelector modelList={[]} readonly />)

    fireEvent.click(screen.getByRole('combobox'))

    expect(screen.getByText('closed-readonly')).toBeInTheDocument()
  })
})
