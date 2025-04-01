import { render, screen } from '@testing-library/react'
import '@testing-library/jest-dom'
import { z } from 'zod'
import withValidation from '.'

describe('withValidation HOC', () => {
  // schema for validation
  const schema = z.object({ name: z.string() })
  type Props = z.infer<typeof schema> & {
    age: number
  }

  const TestComponent = ({ name, age }: Props) => (
    <div>{name} - {age}</div>
  )
  const WrappedComponent = withValidation(TestComponent, schema)

  beforeAll(() => {
    jest.spyOn(console, 'error').mockImplementation(() => { })
  })

  afterAll(() => {
    jest.restoreAllMocks()
  })

  it('renders the component when validation passes', () => {
    render(<WrappedComponent name='Valid Name' age={30} />)
    expect(screen.getByText('Valid Name - 30')).toBeInTheDocument()
  })

  it('renders the component when props is invalid but not in schema ', () => {
    render(<WrappedComponent name='Valid Name' age={'aaa' as any} />)
    expect(screen.getByText('Valid Name - aaa')).toBeInTheDocument()
  })

  it('does not render the component when validation fails', () => {
    render(<WrappedComponent name={123 as any} age={30} />)
    expect(screen.queryByText('123 - 30')).toBeNull()
  })
})
