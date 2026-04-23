import { render, screen } from '@testing-library/react'
import QAItem from '../q-a-item'
import { QAItemType } from '../types'

describe('QAItem', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('should render the question prefix', () => {
    render(<QAItem type={QAItemType.Question} text="What is Dify?" />)

    expect(screen.getByText('Q')).toBeInTheDocument()
    expect(screen.getByText('What is Dify?')).toBeInTheDocument()
  })

  it('should render the answer prefix', () => {
    render(<QAItem type={QAItemType.Answer} text="An LLM app platform." />)

    expect(screen.getByText('A')).toBeInTheDocument()
    expect(screen.getByText('An LLM app platform.')).toBeInTheDocument()
  })
})
