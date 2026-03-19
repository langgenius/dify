import { render, screen } from '@testing-library/react'
import { BoxGroupField, FieldTitle } from '../index'

describe('layout index', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  // The barrel exports should compose the public layout primitives without extra wrappers.
  describe('Rendering', () => {
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

    it('should render FieldTitle from the barrel export', () => {
      render(<FieldTitle title="Advanced" subTitle="Extra details" />)

      expect(screen.getByText('Advanced')).toBeInTheDocument()
      expect(screen.getByText('Extra details')).toBeInTheDocument()
    })
  })
})
