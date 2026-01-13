import { fireEvent, render, screen } from '@testing-library/react'
import * as React from 'react'
import { Plan } from '../../../type'
import Button from './button'

describe('CloudPlanButton', () => {
  describe('Disabled state', () => {
    it('should disable button and hide arrow when plan is not available', () => {
      const handleGetPayUrl = vi.fn()
      // Arrange
      render(
        <Button
          plan={Plan.team}
          isPlanDisabled
          btnText="Get started"
          handleGetPayUrl={handleGetPayUrl}
        />,
      )

      const button = screen.getByRole('button', { name: /Get started/i })
      // Assert
      expect(button).toBeDisabled()
      expect(button.className).toContain('cursor-not-allowed')
      expect(handleGetPayUrl).not.toHaveBeenCalled()
    })
  })

  describe('Enabled state', () => {
    it('should invoke handler and render arrow when plan is available', () => {
      const handleGetPayUrl = vi.fn()
      // Arrange
      render(
        <Button
          plan={Plan.sandbox}
          isPlanDisabled={false}
          btnText="Start now"
          handleGetPayUrl={handleGetPayUrl}
        />,
      )

      const button = screen.getByRole('button', { name: /Start now/i })
      // Act
      fireEvent.click(button)

      // Assert
      expect(handleGetPayUrl).toHaveBeenCalledTimes(1)
      expect(button).not.toBeDisabled()
    })
  })
})
