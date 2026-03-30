import type { WorkflowProcess } from '@/app/components/base/chat/types'
import { render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import ResultTab from '../result-tab'

vi.mock('@/app/components/base/file-uploader', () => ({
  FileList: ({ files }: { files: Array<{ id: string }> }) => <div>{`files:${files.length}`}</div>,
}))

vi.mock('@/app/components/base/markdown', () => ({
  Markdown: ({ content }: { content: string }) => <div>{`markdown:${content}`}</div>,
}))

vi.mock('@/app/components/workflow/nodes/_base/components/editor/code-editor', () => ({
  default: ({ value }: { value: unknown }) => <div>{`code-editor:${String(value)}`}</div>,
}))

describe('ResultTab', () => {
  it('should render markdown text and uploaded files in result mode', () => {
    const workflowProcessData = {
      files: [{
        list: [{ id: 'file-1' }],
        varName: 'documents',
      }],
      resultText: 'Generated result',
    } as unknown as WorkflowProcess

    render(
      <ResultTab
        currentTab="RESULT"
        content={'{"raw":true}'}
        data={workflowProcessData}
      />,
    )

    expect(screen.getByText('markdown:Generated result')).toBeInTheDocument()
    expect(screen.getByText('documents')).toBeInTheDocument()
    expect(screen.getByText('files:1')).toBeInTheDocument()
  })

  it('should render the JSON detail view in detail mode', () => {
    render(
      <ResultTab
        currentTab="DETAIL"
        content={'{"raw":true}'}
      />,
    )

    expect(screen.getByText('code-editor:{"raw":true}')).toBeInTheDocument()
  })
})
