import { render, screen } from '@testing-library/react'
import { Theme } from '@/types/app'
import { CodeBlock } from '../code-block'

vi.mock('@/hooks/use-theme', () => ({ default: () => ({ theme: Theme.light }) }))
vi.mock('echarts-for-react', () => {
  throw new Error('Chart chunk unavailable')
})
vi.mock('../music', () => {
  throw new Error('Music chunk unavailable')
})

it.each([
  ['echarts', '{"series":[]}'],
  ['abc', 'X:1\nK:C\nC D E F|'],
])('contains a failed %s chunk within the code-block error boundary', async (language, content) => {
  const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {})
  try {
    render(<CodeBlock className={`language-${language}`}>{content}</CodeBlock>)
    expect(await screen.findByText(/Oops! An error occurred/)).toBeInTheDocument()
  } finally {
    consoleError.mockRestore()
  }
})
