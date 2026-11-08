import { render, screen } from '@testing-library/react'
import { Markdown } from '../index'

const { mockReactMarkdownWrapper } = vi.hoisted(() => ({
  mockReactMarkdownWrapper: vi.fn(),
}))

vi.mock('next/dynamic', () => ({
  default: () => {
    const MockStreamdownWrapper = (props: { latexContent: string }) => {
      mockReactMarkdownWrapper(props)
      return <div data-testid="react-markdown-wrapper">{props.latexContent}</div>
    }

    MockStreamdownWrapper.displayName = 'MockStreamdownWrapper'
    return MockStreamdownWrapper
  },
}))

type CapturedProps = { latexContent: string; renderSoftBreaks?: boolean }

const getLastWrapperProps = (): CapturedProps => {
  const calls = mockReactMarkdownWrapper.mock.calls
  const lastCall = calls[calls.length - 1]
  return lastCall![0] as CapturedProps
}

describe('Markdown', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it.each(['', ' \n ', '---', ' *** ', '___', '- - -'])(
    'should leave empty or divider-only Markdown unrendered (%s)',
    (content) => {
      render(<Markdown content={content} />)

      expect(screen.getByTestId('markdown-body')).toBeEmptyDOMElement()
      expect(screen.queryByTestId('react-markdown-wrapper')).not.toBeInTheDocument()
    },
  )

  it.each(['First\n\n---\n\nSecond', '    ---'])(
    'should preserve meaningful Markdown containing divider characters (%s)',
    (content) => {
      render(<Markdown content={content} />)

      expect(screen.getByTestId('react-markdown-wrapper')).toBeInTheDocument()
      expect(getLastWrapperProps().latexContent).toBe(content)
    },
  )

  it('should preprocess think tags', () => {
    render(<Markdown content="<think>Thought</think>" />)
    const props = getLastWrapperProps()
    expect(props.latexContent).toContain('<details data-think=true>')
    expect(props.latexContent).toContain('Thought')
    expect(props.latexContent).toContain('[ENDTHINKFLAG]</details>')
  })

  it('should preprocess latex block notation', () => {
    render(<Markdown content={'\\[x^2 + y^2 = z^2\\]'} />)
    const props = getLastWrapperProps()
    expect(props.latexContent).toContain('$$x^2 + y^2 = z^2$$')
  })

  it('should preprocess latex parentheses notation', () => {
    render(<Markdown content={'Inline \\(a + b\\) equation'} />)
    const props = getLastWrapperProps()
    expect(props.latexContent).toContain('$$a + b$$')
  })

  it('should preserve latex inside code blocks', () => {
    render(<Markdown content={'```\n$E = mc^2$\n```'} />)
    const props = getLastWrapperProps()
    expect(props.latexContent).toContain('$E = mc^2$')
  })

  it('should pass renderSoftBreaks through', () => {
    render(<Markdown content={'first line\nsecond line'} renderSoftBreaks={false} />)
    expect(getLastWrapperProps().renderSoftBreaks).toBe(false)
  })
})
