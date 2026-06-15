import { expect } from 'vitest'

export const expectLoadingButton = (button: Element | null) => {
  expect(button).toBeInstanceOf(HTMLButtonElement)
  expect(button).toHaveAttribute('aria-busy', 'true')
  expect(button).toHaveAttribute('aria-disabled', 'true')
  expect(button).not.toHaveAttribute('disabled')
}
