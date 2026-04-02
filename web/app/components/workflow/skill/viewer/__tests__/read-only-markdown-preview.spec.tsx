import { render } from '@testing-library/react'

import ReadOnlyMarkdownPreview from '../read-only-markdown-preview'

const mocks = vi.hoisted(() => ({
  editorProps: [] as Array<Record<string, unknown>>,
}))

vi.mock('../../editor/markdown-file-editor', () => ({
  default: (props: Record<string, unknown>) => {
    mocks.editorProps.push(props)
    return <div data-testid="markdown-editor" />
  },
}))

describe('ReadOnlyMarkdownPreview', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.editorProps.length = 0
  })

  it('should render the markdown editor in read only mode', () => {
    render(<ReadOnlyMarkdownPreview value="# Skill" />)

    expect(mocks.editorProps[0]).toMatchObject({
      value: '# Skill',
      readOnly: true,
    })
    expect(typeof mocks.editorProps[0].onChange).toBe('function')
  })

  it('should provide a no-op change handler for the read-only editor', () => {
    render(<ReadOnlyMarkdownPreview value="# Skill" />)

    expect(() => (mocks.editorProps[0].onChange as () => void)()).not.toThrow()
  })
})
