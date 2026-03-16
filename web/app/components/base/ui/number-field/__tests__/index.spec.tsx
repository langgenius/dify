import { NumberField as BaseNumberField } from '@base-ui/react/number-field'
import { render, screen } from '@testing-library/react'
import {
  NumberField,
  NumberFieldControls,
  NumberFieldDecrement,
  NumberFieldGroup,
  NumberFieldIncrement,
  NumberFieldInput,
  NumberFieldUnit,
} from '../index'

describe('NumberField wrapper', () => {
  describe('Exports', () => {
    it('should map NumberField to the matching base primitive root', () => {
      expect(NumberField).toBe(BaseNumberField.Root)
    })
  })

  describe('Variants', () => {
    it('should apply regular variant classes and forward className to group and input', () => {
      render(
        <NumberField defaultValue={12}>
          <NumberFieldGroup size="regular" className="custom-group" data-testid="group">
            <NumberFieldInput
              aria-label="Regular amount"
              placeholder="Regular placeholder"
              size="regular"
              className="custom-input"
            />
          </NumberFieldGroup>
        </NumberField>,
      )

      const group = screen.getByTestId('group')
      const input = screen.getByRole('textbox', { name: 'Regular amount' })

      expect(group).toHaveClass('radius-md')
      expect(group).toHaveClass('custom-group')
      expect(input).toHaveAttribute('autoComplete', 'off')
      expect(input).toHaveAttribute('inputMode', 'decimal')
      expect(input).toHaveAttribute('placeholder', 'Regular placeholder')
      expect(input).toHaveClass('px-3')
      expect(input).toHaveClass('py-[7px]')
      expect(input).toHaveClass('custom-input')
    })

    it('should apply large variant classes to grouped parts when large size is provided', () => {
      render(
        <NumberField defaultValue={24}>
          <NumberFieldGroup size="large" data-testid="group">
            <NumberFieldInput aria-label="Large amount" size="large" />
            <NumberFieldUnit size="large">ms</NumberFieldUnit>
            <NumberFieldControls>
              <NumberFieldIncrement aria-label="Increment amount" size="large" />
              <NumberFieldDecrement aria-label="Decrement amount" size="large" />
            </NumberFieldControls>
          </NumberFieldGroup>
        </NumberField>,
      )

      const group = screen.getByTestId('group')
      const input = screen.getByRole('textbox', { name: 'Large amount' })
      const unit = screen.getByText('ms')
      const increment = screen.getByRole('button', { name: 'Increment amount' })
      const decrement = screen.getByRole('button', { name: 'Decrement amount' })

      expect(group).toHaveClass('radius-lg')
      expect(input).toHaveClass('px-4')
      expect(input).toHaveClass('py-2')
      expect(unit).toHaveClass('flex')
      expect(unit).toHaveClass('items-center')
      expect(unit).toHaveClass('pr-2.5')
      expect(increment).toHaveClass('pt-1.5')
      expect(decrement).toHaveClass('pb-1.5')
    })
  })

  describe('Passthrough props', () => {
    it('should forward passthrough props and custom classes to controls and buttons', () => {
      render(
        <NumberField defaultValue={8}>
          <NumberFieldGroup size="regular">
            <NumberFieldInput aria-label="Amount" size="regular" />
            <NumberFieldControls className="custom-controls" data-testid="controls">
              <NumberFieldIncrement
                aria-label="Increment"
                size="regular"
                className="custom-increment"
                data-track-id="increment-track"
              />
              <NumberFieldDecrement
                aria-label="Decrement"
                size="regular"
                className="custom-decrement"
                data-track-id="decrement-track"
              />
            </NumberFieldControls>
          </NumberFieldGroup>
        </NumberField>,
      )

      const controls = screen.getByTestId('controls')
      const increment = screen.getByRole('button', { name: 'Increment' })
      const decrement = screen.getByRole('button', { name: 'Decrement' })

      expect(controls).toHaveClass('border-l')
      expect(controls).toHaveClass('custom-controls')
      expect(increment).toHaveClass('custom-increment')
      expect(increment).toHaveAttribute('data-track-id', 'increment-track')
      expect(decrement).toHaveClass('custom-decrement')
      expect(decrement).toHaveAttribute('data-track-id', 'decrement-track')
    })

    it('should provide default icons and localized aria labels for control buttons', () => {
      render(
        <NumberField defaultValue={8}>
          <NumberFieldGroup size="regular">
            <NumberFieldInput aria-label="Amount" size="regular" />
            <NumberFieldControls>
              <NumberFieldIncrement size="regular" />
              <NumberFieldDecrement size="regular" />
            </NumberFieldControls>
          </NumberFieldGroup>
        </NumberField>,
      )

      expect(screen.getByRole('button', { name: 'common.operation.increment' })).toBeInTheDocument()
      expect(screen.getByRole('button', { name: 'common.operation.decrement' })).toBeInTheDocument()
      expect(screen.getByRole('button', { name: 'common.operation.increment' }).querySelector('.i-ri-arrow-up-s-line')).toBeInTheDocument()
      expect(screen.getByRole('button', { name: 'common.operation.decrement' }).querySelector('.i-ri-arrow-down-s-line')).toBeInTheDocument()
    })
  })
})
