import { fireEvent, render, screen } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import FieldInfo from '../field-info'

vi.mock('@/utils', () => ({
  getTextWidthWithCanvas: (text: string) => text.length * 8,
}))

describe('FieldInfo', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  // Verify read-only rendering
  describe('Read-Only Mode', () => {
    it('should render label and displayed value', () => {
      render(<FieldInfo label="Title" displayedValue="My Document" />)

      expect(screen.getByText('Title')).toBeInTheDocument()
      expect(screen.getByText('My Document')).toBeInTheDocument()
    })

    it('should render value icon when provided', () => {
      render(
        <FieldInfo
          label="Status"
          displayedValue="Active"
          valueIcon={<span data-testid="icon">*</span>}
        />,
      )

      expect(screen.getByTestId('icon')).toBeInTheDocument()
    })

    it('should render displayedValue as plain text when not editing', () => {
      render(<FieldInfo label="Author" displayedValue="John" showEdit={false} />)

      expect(screen.getByText('John')).toBeInTheDocument()
      expect(screen.queryByRole('textbox')).not.toBeInTheDocument()
    })
  })

  // Verify edit mode rendering for each inputType
  describe('Edit Mode', () => {
    it('should render input field by default in edit mode', () => {
      render(<FieldInfo label="Title" value="Test" showEdit={true} inputType="input" />)

      const input = screen.getByRole('textbox')
      expect(input).toBeInTheDocument()
      expect(input).toHaveValue('Test')
    })

    it('should render textarea when inputType is textarea', () => {
      render(<FieldInfo label="Desc" value="Long text" showEdit={true} inputType="textarea" />)

      const textarea = screen.getByRole('textbox')
      expect(textarea).toBeInTheDocument()
      expect(textarea).toHaveValue('Long text')
    })

    it('should render select when inputType is select', () => {
      const options = [
        { value: 'en', name: 'English' },
        { value: 'zh', name: 'Chinese' },
      ]
      render(
        <FieldInfo
          label="Language"
          value="en"
          showEdit={true}
          inputType="select"
          selectOptions={options}
        />,
      )

      // SimpleSelect renders a button-like trigger
      expect(screen.getByText('English')).toBeInTheDocument()
    })

    it('should call onUpdate when input value changes', () => {
      const onUpdate = vi.fn()
      render(<FieldInfo label="Title" value="" showEdit={true} inputType="input" onUpdate={onUpdate} />)

      fireEvent.change(screen.getByRole('textbox'), { target: { value: 'New' } })

      expect(onUpdate).toHaveBeenCalledWith('New')
    })

    it('should call onUpdate when textarea value changes', () => {
      const onUpdate = vi.fn()
      render(<FieldInfo label="Desc" value="" showEdit={true} inputType="textarea" onUpdate={onUpdate} />)

      fireEvent.change(screen.getByRole('textbox'), { target: { value: 'Updated' } })

      expect(onUpdate).toHaveBeenCalledWith('Updated')
    })
  })

  // Verify edge cases
  describe('Edge Cases', () => {
    it('should render with empty value and label', () => {
      render(<FieldInfo label="" value="" displayedValue="" />)

      // Should not crash
      const container = document.querySelector('.flex.min-h-5')
      expect(container).toBeInTheDocument()
    })

    it('should render with default value prop', () => {
      render(<FieldInfo label="Field" showEdit={true} inputType="input" defaultValue="default" />)

      expect(screen.getByRole('textbox')).toBeInTheDocument()
    })
  })
})
