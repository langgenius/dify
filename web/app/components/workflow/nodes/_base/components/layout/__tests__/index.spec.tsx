import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { Box, BoxGroup, BoxGroupField, Field, Group, GroupField } from '../index'

describe('layout index', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  // The layout primitives should preserve their composition contracts and collapse behavior.
  describe('Rendering', () => {
    it('should render Box and Group with optional border styles', () => {
      render(
        <div>
          <Box withBorderBottom className="box-test">Box content</Box>
          <Group withBorderBottom className="group-test">Group content</Group>
        </div>,
      )

      expect(screen.getByText('Box content')).toHaveClass('border-b', 'box-test')
      expect(screen.getByText('Group content')).toHaveClass('border-b', 'group-test')
    })

    it('should render BoxGroup and GroupField with nested children', () => {
      render(
        <div>
          <BoxGroup>Inside box group</BoxGroup>
          <GroupField
            fieldProps={{
              fieldTitleProps: {
                title: 'Grouped field',
              },
            }}
          >
            Group field body
          </GroupField>
        </div>,
      )

      expect(screen.getByText('Inside box group')).toBeInTheDocument()
      expect(screen.getByText('Grouped field')).toBeInTheDocument()
      expect(screen.getByText('Group field body')).toBeInTheDocument()
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
        <Field
          supportCollapse
          fieldTitleProps={{ title: 'Advanced' }}
        >
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
