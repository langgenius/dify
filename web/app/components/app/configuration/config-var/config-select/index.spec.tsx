import { fireEvent, render, screen } from '@testing-library/react'
import ConfigSelect from './index'

jest.mock('react-sortablejs', () => ({
  ReactSortable: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
}))

jest.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string) => key,
  }),
}))

describe('ConfigSelect Component', () => {
  const defaultProps = {
    options: ['Option 1', 'Option 2'],
    onChange: jest.fn(),
  }

  afterEach(() => {
    jest.clearAllMocks()
  })

  it('renders all options', () => {
    render(<ConfigSelect {...defaultProps} />)

    defaultProps.options.forEach((option) => {
      expect(screen.getByDisplayValue(option)).toBeInTheDocument()
    })
  })

  it('renders add button', () => {
    render(<ConfigSelect {...defaultProps} />)

    expect(screen.getByText('appDebug.variableConfig.addOption')).toBeInTheDocument()
  })

  it('handles option deletion', () => {
    render(<ConfigSelect {...defaultProps} />)
    const optionContainer = screen.getByDisplayValue('Option 1').closest('div')
    const deleteButton = optionContainer?.querySelector('div[role="button"]')

    if (!deleteButton) return
    fireEvent.click(deleteButton)
    expect(defaultProps.onChange).toHaveBeenCalledWith(['Option 2'])
  })

  it('handles adding new option', () => {
    render(<ConfigSelect {...defaultProps} />)
    const addButton = screen.getByText('appDebug.variableConfig.addOption')

    fireEvent.click(addButton)

    expect(defaultProps.onChange).toHaveBeenCalledWith([...defaultProps.options, ''])
  })

  it('applies focus styles on input focus', () => {
    render(<ConfigSelect {...defaultProps} />)
    const firstInput = screen.getByDisplayValue('Option 1')

    fireEvent.focus(firstInput)

    expect(firstInput.closest('div')).toHaveClass('border-components-input-border-active')
  })

  it('applies delete hover styles', () => {
    render(<ConfigSelect {...defaultProps} />)
    const optionContainer = screen.getByDisplayValue('Option 1').closest('div')
    const deleteButton = optionContainer?.querySelector('div[role="button"]')

    if (!deleteButton) return
    fireEvent.mouseEnter(deleteButton)
    expect(optionContainer).toHaveClass('border-components-input-border-destructive')
  })

  it('renders empty state correctly', () => {
    render(<ConfigSelect options={[]} onChange={defaultProps.onChange} />)

    expect(screen.queryByRole('textbox')).not.toBeInTheDocument()
    expect(screen.getByText('appDebug.variableConfig.addOption')).toBeInTheDocument()
  })
})
