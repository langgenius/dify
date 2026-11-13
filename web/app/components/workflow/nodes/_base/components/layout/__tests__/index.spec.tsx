import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { Field } from '../field'

describe('layout index', () => {
  // The layout primitives should preserve their composition contracts and collapse behavior.
  describe('Rendering', () => {
    it('should collapse and expand Field children when supportCollapse is enabled', async () => {
      const user = userEvent.setup()
      render(
        <Field supportCollapse fieldTitleProps={{ title: 'Advanced' }}>
          <div>Extra details</div>
        </Field>,
      )

      expect(screen.getByText('Extra details')).toBeInTheDocument()

      await user.click(screen.getByText('Advanced'))
      expect(screen.queryByText('Extra details')).not.toBeInTheDocument()

      await user.click(screen.getByText('Advanced'))
      expect(screen.getByText('Extra details')).toBeInTheDocument()
    })
  })
})
