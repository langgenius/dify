/* eslint-disable ts/no-explicit-any */
import { render, screen } from '@testing-library/react'
import ResultTab from '../result-tab'

vi.mock('@/app/components/base/markdown', () => ({
  Markdown: ({ content }: { content: string }) => (
    <div>
      markdown:
      {content}
    </div>
  ),
}))

vi.mock('@/app/components/base/file-uploader', () => ({
  FileList: ({ files }: { files: Array<{ id: string }> }) => (
    <div>
      files:
      {files.length}
    </div>
  ),
}))

vi.mock('@/app/components/workflow/nodes/_base/components/editor/code-editor', () => ({
  default: ({ value }: { value: string }) => (
    <div>
      code-editor:
      {value}
    </div>
  ),
}))

describe('ResultTab', () => {
  it('should render workflow result text and files on the result tab', () => {
    render(
      <ResultTab
        currentTab="RESULT"
        content=""
        data={{
          resultText: 'Hello world',
          files: [
            {
              varName: 'attachments',
              list: [{ id: 'file-1' }],
            },
          ],
        } as any}
      />,
    )

    expect(screen.getByText('markdown:Hello world')).toBeInTheDocument()
    expect(screen.getByText('attachments')).toBeInTheDocument()
    expect(screen.getByText('files:1')).toBeInTheDocument()
  })

  it('should render the raw detail view on the detail tab', () => {
    render(
      <ResultTab
        currentTab="DETAIL"
        content='{"answer":"ok"}'
      />,
    )

    expect(screen.getByText('code-editor:{"answer":"ok"}')).toBeInTheDocument()
  })
})
