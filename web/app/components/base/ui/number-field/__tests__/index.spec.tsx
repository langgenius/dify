import type { ReactNode } from 'react'
import type {
  NumberFieldButtonProps,
  NumberFieldControlsProps,
  NumberFieldGroupProps,
  NumberFieldInputProps,
  NumberFieldUnitProps,
} from '../index'
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

type RenderNumberFieldOptions = {
  defaultValue?: number
  groupProps?: Partial<NumberFieldGroupProps>
  inputProps?: Partial<NumberFieldInputProps>
  unitProps?: Partial<NumberFieldUnitProps> & { children?: ReactNode }
  controlsProps?: Partial<NumberFieldControlsProps>
  incrementProps?: Partial<NumberFieldButtonProps>
  decrementProps?: Partial<NumberFieldButtonProps>
}

const renderNumberField = ({
  defaultValue = 8,
  groupProps,
  inputProps,
  unitProps,
  controlsProps,
  incrementProps,
  decrementProps,
}: RenderNumberFieldOptions = {}) => {
  const {
    children: unitChildren = 'ms',
    ...restUnitProps
  } = unitProps ?? {}

  return render(
    <NumberField defaultValue={defaultValue}>
      <NumberFieldGroup data-testid="group" {...groupProps}>
        <NumberFieldInput
          aria-label="Amount"
          data-testid="input"
          {...inputProps}
        />
        {unitProps && (
          <NumberFieldUnit data-testid="unit" {...restUnitProps}>
            {unitChildren}
          </NumberFieldUnit>
        )}
        {(controlsProps || incrementProps || decrementProps) && (
          <NumberFieldControls data-testid="controls" {...controlsProps}>
            <NumberFieldIncrement data-testid="increment" {...incrementProps} />
            <NumberFieldDecrement data-testid="decrement" {...decrementProps} />
          </NumberFieldControls>
        )}
      </NumberFieldGroup>
    </NumberField>,
  )
}

describe('NumberField wrapper', () => {
  // Group and input wrappers should preserve the design-system variants and DOM defaults.
  describe('Group and input', () => {
    it('should apply medium group classes by default and merge custom className', () => {
      renderNumberField({
        groupProps: {
          className: 'custom-group',
        },
      })

      const group = screen.getByTestId('group')

      expect(group).toHaveClass('rounded-lg')
      expect(group).toHaveClass('custom-group')
    })

    it('should apply large group and input classes when large size is provided', () => {
      renderNumberField({
        groupProps: {
          size: 'large',
        },
        inputProps: {
          size: 'large',
        },
      })

      const group = screen.getByTestId('group')
      const input = screen.getByTestId('input')

      expect(group).toHaveClass('rounded-[10px]')
      expect(input).toHaveClass('px-4')
      expect(input).toHaveClass('py-2')
    })

    it('should set input defaults and forward passthrough props', () => {
      renderNumberField({
        inputProps: {
          className: 'custom-input',
          placeholder: 'Regular placeholder',
          required: true,
        },
      })

      const input = screen.getByRole('textbox', { name: 'Amount' })

      expect(input).toHaveAttribute('autoComplete', 'off')
      expect(input).toHaveAttribute('autoCorrect', 'off')
      expect(input).toHaveAttribute('placeholder', 'Regular placeholder')
      expect(input).toBeRequired()
      expect(input).toHaveClass('px-3')
      expect(input).toHaveClass('py-[7px]')
      expect(input).toHaveClass('system-sm-regular')
      expect(input).toHaveClass('custom-input')
    })
  })

  // Unit and controls wrappers should preserve layout tokens and HTML passthrough props.
  describe('Unit and controls', () => {
    it.each([
      ['medium', 'pr-2'],
      ['large', 'pr-2.5'],
    ] as const)('should apply the %s unit spacing variant', (size, spacingClass) => {
      renderNumberField({
        unitProps: {
          size,
          className: 'custom-unit',
          title: `unit-${size}`,
        },
      })

      const unit = screen.getByTestId('unit')

      expect(unit).toHaveTextContent('ms')
      expect(unit).toHaveAttribute('title', `unit-${size}`)
      expect(unit).toHaveClass('custom-unit')
      expect(unit).toHaveClass(spacingClass)
    })

    it('should forward passthrough props to controls', () => {
      renderNumberField({
        controlsProps: {
          className: 'custom-controls',
          title: 'controls-title',
        },
      })

      const controls = screen.getByTestId('controls')

      expect(controls).toHaveAttribute('title', 'controls-title')
      expect(controls).toHaveClass('custom-controls')
    })
  })

  // Increment and decrement buttons should preserve accessible naming, icon fallbacks, and spacing variants.
  describe('Control buttons', () => {
    it('should provide english fallback aria labels and default icons when labels are not provided', () => {
      renderNumberField({
        controlsProps: {},
      })

      const increment = screen.getByRole('button', { name: 'Increment value' })
      const decrement = screen.getByRole('button', { name: 'Decrement value' })

      expect(increment.querySelector('.i-ri-arrow-up-s-line')).toBeInTheDocument()
      expect(decrement.querySelector('.i-ri-arrow-down-s-line')).toBeInTheDocument()
    })

    it('should preserve explicit aria labels and custom children', () => {
      renderNumberField({
        controlsProps: {},
        incrementProps: {
          'aria-label': 'Increase amount',
          'children': <span data-testid="custom-increment-icon">+</span>,
        },
        decrementProps: {
          'aria-label': 'Decrease amount',
          'children': <span data-testid="custom-decrement-icon">-</span>,
        },
      })

      const increment = screen.getByRole('button', { name: 'Increase amount' })
      const decrement = screen.getByRole('button', { name: 'Decrease amount' })

      expect(increment).toContainElement(screen.getByTestId('custom-increment-icon'))
      expect(decrement).toContainElement(screen.getByTestId('custom-decrement-icon'))
      expect(increment.querySelector('.i-ri-arrow-up-s-line')).not.toBeInTheDocument()
      expect(decrement.querySelector('.i-ri-arrow-down-s-line')).not.toBeInTheDocument()
    })

    it('should keep the fallback aria labels when aria-label is omitted in props', () => {
      renderNumberField({
        controlsProps: {},
        incrementProps: {
          'aria-label': undefined,
        },
        decrementProps: {
          'aria-label': undefined,
        },
      })

      expect(screen.getByRole('button', { name: 'Increment value' })).toBeInTheDocument()
      expect(screen.getByRole('button', { name: 'Decrement value' })).toBeInTheDocument()
    })

    it('should rely on aria-labelledby when provided instead of injecting a fallback aria-label', () => {
      render(
        <>
          <span id="increment-label">Increment from label</span>
          <span id="decrement-label">Decrement from label</span>
          <NumberField defaultValue={8}>
            <NumberFieldGroup size="medium">
              <NumberFieldInput aria-label="Amount" size="medium" />
              <NumberFieldControls>
                <NumberFieldIncrement aria-labelledby="increment-label" size="medium" />
                <NumberFieldDecrement aria-labelledby="decrement-label" size="medium" />
              </NumberFieldControls>
            </NumberFieldGroup>
          </NumberField>
        </>,
      )

      const increment = screen.getByRole('button', { name: 'Increment from label' })
      const decrement = screen.getByRole('button', { name: 'Decrement from label' })

      expect(increment).not.toHaveAttribute('aria-label')
      expect(decrement).not.toHaveAttribute('aria-label')
    })

    it.each([
      ['medium', 'pt-1', 'pb-1'],
      ['large', 'pt-1.5', 'pb-1.5'],
    ] as const)('should apply the %s control button compound spacing classes', (size, incrementClass, decrementClass) => {
      renderNumberField({
        controlsProps: {},
        incrementProps: {
          size,
          className: 'custom-increment',
        },
        decrementProps: {
          size,
          className: 'custom-decrement',
          title: `decrement-${size}`,
        },
      })

      const increment = screen.getByTestId('increment')
      const decrement = screen.getByTestId('decrement')

      expect(increment).toHaveClass(incrementClass)
      expect(increment).toHaveClass('custom-increment')
      expect(decrement).toHaveClass(decrementClass)
      expect(decrement).toHaveClass('custom-decrement')
      expect(decrement).toHaveAttribute('title', `decrement-${size}`)
    })
  })
})
