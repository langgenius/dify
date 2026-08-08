import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { BoxGroup, BoxGroupField, Field } from '../index'

describe('layout index', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  // The layout primitives should preserve their composition contracts and collapse behavior.
  describe('Rendering', () => {
    it('should render BoxGroup with nested children', () => {
      render(<BoxGroup>Inside box group</BoxGroup>)

      expect(screen.getByText('Inside box group')).toBeInTheDocument()
    })

    it('should render BoxGroupField from the barrel export', () => {
      render(
        <BoxGroupField
          fieldProps={{
            fieldTitleProps: {
              title: 'Input',
            },
          }}
        >
          Body content
        </BoxGroupField>,
      )

      expect(screen.getByText('Input')).toBeInTheDocument()
      expect(screen.getByText('Body content')).toBeInTheDocument()
    })

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
