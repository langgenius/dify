import type { SimplePluginInfo } from './react-markdown-wrapper'
import { render, screen } from '@testing-library/react'
import { Markdown } from './index'

const { mockReactMarkdownWrapper } = vi.hoisted(() => ({
  mockReactMarkdownWrapper: vi.fn(),
}))

vi.mock('next/dynamic', () => ({
  default: () => (props: { latexContent: string }) => {
    mockReactMarkdownWrapper(props)
    return <div data-testid="react-markdown-wrapper">{props.latexContent}</div>
  },
}))

type CapturedProps = {
  latexContent: string
  pluginInfo?: SimplePluginInfo
  customComponents?: Record<string, unknown>
  customDisallowedElements?: string[]
  rehypePlugins?: unknown[]
}

const getLastWrapperProps = (): CapturedProps => {
  const calls = mockReactMarkdownWrapper.mock.calls
  const lastCall = calls[calls.length - 1]
  return lastCall[0] as CapturedProps
}

describe('Markdown', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('should render wrapper content', () => {
    render(<Markdown content="Hello World" />)
    expect(screen.getByTestId('react-markdown-wrapper')).toHaveTextContent('Hello World')
  })

  it('should apply default classes', () => {
    const { container } = render(<Markdown content="Test" />)
    const markdownDiv = container.querySelector('.markdown-body')
    expect(markdownDiv).toHaveClass('markdown-body', '!text-text-primary')
  })

  it('should merge custom className with default classes', () => {
    const { container } = render(<Markdown content="Test" className="custom another" />)
    const markdownDiv = container.querySelector('.markdown-body')
    expect(markdownDiv).toHaveClass('markdown-body', '!text-text-primary', 'custom', 'another')
  })

  it('should not include undefined in className', () => {
    const { container } = render(<Markdown content="Test" className={undefined} />)
    const markdownDiv = container.querySelector('.markdown-body')
    expect(markdownDiv?.className).not.toContain('undefined')
  })

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

  it('should pass pluginInfo through', () => {
    const pluginInfo = {
      pluginUniqueIdentifier: 'plugin-unique',
      pluginId: 'plugin-id',
    }
    render(<Markdown content="content" pluginInfo={pluginInfo} />)
    const props = getLastWrapperProps()
    expect(props.pluginInfo).toEqual(pluginInfo)
  })

  it('should pass default empty customComponents when omitted', () => {
    render(<Markdown content="content" />)
    const props = getLastWrapperProps()
    expect(props.customComponents).toEqual({})
  })

  it('should pass customComponents through', () => {
    const customComponents = {
      h1: ({ children }: { children: React.ReactNode }) => <h1>{children}</h1>,
    }
    render(<Markdown content="# title" customComponents={customComponents} />)
    const props = getLastWrapperProps()
    expect(props.customComponents).toBe(customComponents)
  })

  it('should pass customDisallowedElements through', () => {
    const customDisallowedElements = ['strong', 'em']
    render(<Markdown content="**bold**" customDisallowedElements={customDisallowedElements} />)
    const props = getLastWrapperProps()
    expect(props.customDisallowedElements).toBe(customDisallowedElements)
  })

  it('should pass rehypePlugins through', () => {
    const plugin = () => (tree: unknown) => tree
    const rehypePlugins = [plugin]
    render(<Markdown content="content" rehypePlugins={rehypePlugins} />)
    const props = getLastWrapperProps()
    expect(props.rehypePlugins).toBe(rehypePlugins)
  })
})
