import type { ReactNode } from 'react'
import type {
  NumberFieldButtonProps,
  NumberFieldControlsProps,
  NumberFieldGroupProps,
  NumberFieldInputProps,
  NumberFieldUnitProps,
} from '../index'
import { render } from 'vitest-browser-react'
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
  describe('Group and input', () => {
    it('should apply medium group classes by default and merge custom className', async () => {
      const screen = await renderNumberField({
        groupProps: {
          className: 'custom-group',
        },
      })

      await expect.element(screen.getByTestId('group')).toHaveClass('rounded-lg')
      await expect.element(screen.getByTestId('group')).toHaveClass('custom-group')
    })

    it('should apply large group and input classes when large size is provided', async () => {
      const screen = await renderNumberField({
        groupProps: {
          size: 'large',
        },
        inputProps: {
          size: 'large',
        },
      })

      await expect.element(screen.getByTestId('group')).toHaveClass('rounded-[10px]')
      await expect.element(screen.getByTestId('input')).toHaveClass('px-4')
      await expect.element(screen.getByTestId('input')).toHaveClass('py-2')
    })

    it('should set input defaults and forward passthrough props', async () => {
      const screen = await renderNumberField({
        inputProps: {
          className: 'custom-input',
          placeholder: 'Regular placeholder',
          required: true,
        },
      })

      await expect.element(screen.getByRole('textbox', { name: 'Amount' })).toHaveAttribute('autocomplete', 'off')
      await expect.element(screen.getByRole('textbox', { name: 'Amount' })).toHaveAttribute('autocorrect', 'off')
      await expect.element(screen.getByRole('textbox', { name: 'Amount' })).toHaveAttribute('placeholder', 'Regular placeholder')
      await expect.element(screen.getByRole('textbox', { name: 'Amount' })).toBeRequired()
      await expect.element(screen.getByRole('textbox', { name: 'Amount' })).toHaveClass('px-3')
      await expect.element(screen.getByRole('textbox', { name: 'Amount' })).toHaveClass('py-[7px]')
      await expect.element(screen.getByRole('textbox', { name: 'Amount' })).toHaveClass('system-sm-regular')
      await expect.element(screen.getByRole('textbox', { name: 'Amount' })).toHaveClass('custom-input')
    })
  })

  describe('Unit and controls', () => {
    it.each([
      ['medium', 'pr-2'],
      ['large', 'pr-2.5'],
    ] as const)('should apply the %s unit spacing variant', async (size, spacingClass) => {
      const screen = await renderNumberField({
        unitProps: {
          size,
          className: 'custom-unit',
          title: `unit-${size}`,
        },
      })

      await expect.element(screen.getByTestId('unit')).toHaveTextContent('ms')
      await expect.element(screen.getByTestId('unit')).toHaveAttribute('title', `unit-${size}`)
      await expect.element(screen.getByTestId('unit')).toHaveClass('custom-unit')
      await expect.element(screen.getByTestId('unit')).toHaveClass(spacingClass)
    })

    it('should forward passthrough props to controls', async () => {
      const screen = await renderNumberField({
        controlsProps: {
          className: 'custom-controls',
          title: 'controls-title',
        },
      })

      await expect.element(screen.getByTestId('controls')).toHaveAttribute('title', 'controls-title')
      await expect.element(screen.getByTestId('controls')).toHaveClass('custom-controls')
    })
  })

  describe('Control buttons', () => {
    it('should provide english fallback aria labels and default icons when labels are not provided', async () => {
      const screen = await renderNumberField({
        controlsProps: {},
      })

      expect(screen.getByRole('button', { name: 'Increment value' }).element().querySelector('.i-ri-arrow-up-s-line')).toBeInTheDocument()
      expect(screen.getByRole('button', { name: 'Decrement value' }).element().querySelector('.i-ri-arrow-down-s-line')).toBeInTheDocument()
    })

    it('should preserve explicit aria labels and custom children', async () => {
      const screen = await renderNumberField({
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

      expect(screen.getByRole('button', { name: 'Increase amount' }).element()).toContainElement(screen.getByTestId('custom-increment-icon').element())
      expect(screen.getByRole('button', { name: 'Decrease amount' }).element()).toContainElement(screen.getByTestId('custom-decrement-icon').element())
      expect(screen.getByRole('button', { name: 'Increase amount' }).element().querySelector('.i-ri-arrow-up-s-line')).not.toBeInTheDocument()
      expect(screen.getByRole('button', { name: 'Decrease amount' }).element().querySelector('.i-ri-arrow-down-s-line')).not.toBeInTheDocument()
    })

    it('should keep the fallback aria labels when aria-label is omitted in props', async () => {
      const screen = await renderNumberField({
        controlsProps: {},
        incrementProps: {
          'aria-label': undefined,
        },
        decrementProps: {
          'aria-label': undefined,
        },
      })

      await expect.element(screen.getByRole('button', { name: 'Increment value' })).toBeInTheDocument()
      await expect.element(screen.getByRole('button', { name: 'Decrement value' })).toBeInTheDocument()
    })

    it('should rely on aria-labelledby when provided instead of injecting a fallback aria-label', async () => {
      const screen = await render(
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

      await expect.element(screen.getByRole('button', { name: 'Increment from label' })).not.toHaveAttribute('aria-label')
      await expect.element(screen.getByRole('button', { name: 'Decrement from label' })).not.toHaveAttribute('aria-label')
    })

    it.each([
      ['medium', 'pt-1', 'pb-1'],
      ['large', 'pt-1.5', 'pb-1.5'],
    ] as const)('should apply the %s control button compound spacing classes', async (size, incrementClass, decrementClass) => {
      const screen = await renderNumberField({
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

      await expect.element(screen.getByTestId('increment')).toHaveClass(incrementClass)
      await expect.element(screen.getByTestId('increment')).toHaveClass('custom-increment')
      await expect.element(screen.getByTestId('decrement')).toHaveClass(decrementClass)
      await expect.element(screen.getByTestId('decrement')).toHaveClass('custom-decrement')
      await expect.element(screen.getByTestId('decrement')).toHaveAttribute('title', `decrement-${size}`)
    })
  })
})
