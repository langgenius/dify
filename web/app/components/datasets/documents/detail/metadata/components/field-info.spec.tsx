import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import FieldInfo from './field-info'

vi.mock('@/utils', () => ({
  getTextWidthWithCanvas: vi.fn().mockReturnValue(100),
}))

describe('FieldInfo', () => {
  describe('rendering', () => {
    it('should render label and displayed value', () => {
      render(<FieldInfo label="Title" displayedValue="Test Value" />)

      expect(screen.getByText('Title')).toBeInTheDocument()
      expect(screen.getByText('Test Value')).toBeInTheDocument()
    })

    it('should render valueIcon when provided', () => {
      const icon = <span data-testid="test-icon">Icon</span>
      render(<FieldInfo label="Title" displayedValue="Value" valueIcon={icon} />)

      expect(screen.getByTestId('test-icon')).toBeInTheDocument()
    })

    it('should render displayed value when not in edit mode', () => {
      render(<FieldInfo label="Title" displayedValue="Display Text" showEdit={false} />)

      expect(screen.getByText('Display Text')).toBeInTheDocument()
    })
  })

  describe('edit mode - input type', () => {
    it('should render input when showEdit is true and inputType is input', () => {
      render(<FieldInfo label="Title" value="test" showEdit inputType="input" />)

      const input = screen.getByRole('textbox')
      expect(input).toBeInTheDocument()
      expect(input).toHaveValue('test')
    })

    it('should call onUpdate when input value changes', () => {
      const onUpdate = vi.fn()
      render(<FieldInfo label="Title" value="" showEdit inputType="input" onUpdate={onUpdate} />)

      const input = screen.getByRole('textbox')
      fireEvent.change(input, { target: { value: 'new value' } })

      expect(onUpdate).toHaveBeenCalledWith('new value')
    })

    it('should render with defaultValue', () => {
      render(<FieldInfo label="Title" defaultValue="default" showEdit inputType="input" />)

      const input = screen.getByRole('textbox')
      expect(input).toBeInTheDocument()
    })
  })

  describe('edit mode - textarea type', () => {
    it('should render textarea when inputType is textarea', () => {
      render(<FieldInfo label="Description" value="test desc" showEdit inputType="textarea" />)

      const textarea = screen.getByRole('textbox')
      expect(textarea).toBeInTheDocument()
      expect(textarea).toHaveValue('test desc')
    })

    it('should call onUpdate when textarea value changes', () => {
      const onUpdate = vi.fn()
      render(<FieldInfo label="Description" value="" showEdit inputType="textarea" onUpdate={onUpdate} />)

      const textarea = screen.getByRole('textbox')
      fireEvent.change(textarea, { target: { value: 'new description' } })

      expect(onUpdate).toHaveBeenCalledWith('new description')
    })
  })

  describe('edit mode - select type', () => {
    const selectOptions = [
      { value: 'en', name: 'English' },
      { value: 'zh', name: 'Chinese' },
    ]

    it('should render select when inputType is select', () => {
      render(
        <FieldInfo
          label="Language"
          value="en"
          showEdit
          inputType="select"
          selectOptions={selectOptions}
        />,
      )

      expect(screen.getByText('English')).toBeInTheDocument()
    })

    it('should call onUpdate when select value changes', () => {
      const onUpdate = vi.fn()
      render(
        <FieldInfo
          label="Language"
          value="en"
          showEdit
          inputType="select"
          selectOptions={selectOptions}
          onUpdate={onUpdate}
        />,
      )

      const selectTrigger = screen.getByText('English')
      fireEvent.click(selectTrigger)

      const chineseOption = screen.getByText('Chinese')
      fireEvent.click(chineseOption)

      expect(onUpdate).toHaveBeenCalledWith('zh')
    })
  })

  describe('alignment', () => {
    it('should apply top alignment class for textarea edit mode', () => {
      const { container } = render(
        <FieldInfo label="Description" showEdit inputType="textarea" />,
      )

      const wrapper = container.firstChild
      expect(wrapper).toHaveClass('!items-start')
    })
  })

  describe('default props', () => {
    it('should use default empty string for value', () => {
      render(<FieldInfo label="Title" showEdit inputType="input" />)

      const input = screen.getByRole('textbox')
      expect(input).toHaveValue('')
    })

    it('should use default input type', () => {
      render(<FieldInfo label="Title" showEdit />)

      expect(screen.getByRole('textbox')).toBeInTheDocument()
    })

    it('should use empty select options by default', () => {
      const { container } = render(<FieldInfo label="Select Field" showEdit inputType="select" />)
      expect(container.querySelector('button')).toBeInTheDocument()
    })
  })
})
