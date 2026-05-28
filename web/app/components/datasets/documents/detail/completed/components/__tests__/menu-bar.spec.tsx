import { CheckboxGroup } from '@langgenius/dify-ui/checkbox-group'
import { fireEvent, render, screen } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import MenuBar from '../menu-bar'

vi.mock('../../display-toggle', () => ({
  default: ({ isCollapsed, toggleCollapsed }: { isCollapsed: boolean, toggleCollapsed: () => void }) => (
    <button data-testid="display-toggle" onClick={toggleCollapsed}>
      {isCollapsed ? 'collapsed' : 'expanded'}
    </button>
  ),
}))

describe('MenuBar', () => {
  const defaultProps = {
    hasSelectableSegments: true,
    isLoading: false,
    totalText: '10 Chunks',
    statusList: [
      { value: 'all', name: 'All' },
      { value: 0, name: 'Enabled' },
      { value: 1, name: 'Disabled' },
    ],
    selectDefaultValue: 'all' as const,
    onChangeStatus: vi.fn(),
    inputValue: '',
    onInputChange: vi.fn(),
    isCollapsed: false,
    toggleCollapsed: vi.fn(),
  }

  beforeEach(() => {
    vi.clearAllMocks()
  })

  const renderMenuBar = (props: Partial<typeof defaultProps> = {}) => {
    return render(
      <CheckboxGroup value={[]} onValueChange={vi.fn()} allValues={['seg-1']}>
        <MenuBar {...defaultProps} {...props} />
      </CheckboxGroup>,
    )
  }

  it('should render total text', () => {
    renderMenuBar()
    expect(screen.getByText('10 Chunks')).toBeInTheDocument()
  })

  it('should render checkbox', () => {
    renderMenuBar()

    expect(screen.getByRole('checkbox', { name: 'common.operation.selectAll' })).toBeInTheDocument()
  })

  it('should not render select all checkbox when there are no selectable segments', () => {
    renderMenuBar({ hasSelectableSegments: false })

    expect(screen.queryByRole('checkbox', { name: 'common.operation.selectAll' })).not.toBeInTheDocument()
  })

  it('should call onInputChange when input changes', () => {
    renderMenuBar()
    const input = screen.getByRole('textbox')
    fireEvent.change(input, { target: { value: 'test search' } })
    expect(defaultProps.onInputChange).toHaveBeenCalledWith('test search')
  })

  it('should render display toggle', () => {
    renderMenuBar()
    expect(screen.getByTestId('display-toggle')).toBeInTheDocument()
  })

  it('should call toggleCollapsed when display toggle clicked', () => {
    renderMenuBar()
    fireEvent.click(screen.getByTestId('display-toggle'))
    expect(defaultProps.toggleCollapsed).toHaveBeenCalled()
  })

  it('should call onInputChange with empty string when input is cleared', () => {
    renderMenuBar({ inputValue: 'some text' })
    const clearButton = screen.getByRole('button', { name: 'common.operation.clear' })
    fireEvent.click(clearButton)
    expect(defaultProps.onInputChange).toHaveBeenCalledWith('')
  })

  it('should render the selected status in the trigger', () => {
    renderMenuBar()
    expect(screen.getByText('All')).toBeInTheDocument()
  })

  it('should render status options when dropdown is opened', async () => {
    renderMenuBar()

    const selectButton = screen.getByRole('combobox')
    fireEvent.click(selectButton)

    expect(await screen.findByRole('option', { name: 'All' })).toBeInTheDocument()
    expect(screen.getByRole('option', { name: 'Enabled' })).toBeInTheDocument()
    expect(screen.getByRole('option', { name: 'Disabled' })).toBeInTheDocument()
  })
})
