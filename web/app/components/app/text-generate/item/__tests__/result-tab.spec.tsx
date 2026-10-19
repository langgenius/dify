import type { WorkflowProcess } from '@/app/components/base/chat/types'
import type { FileEntity } from '@/app/components/base/file-uploader/types'
import { render, screen } from '@testing-library/react'
import { WorkflowRunningStatus } from '@/app/components/workflow/types'
import { TransferMethod } from '@/types/app'
import ResultTab from '../result-tab'

vi.mock('@/app/components/workflow/nodes/_base/components/editor/code-editor', () => ({
  default: ({ value, readOnly }: { value: string; readOnly: boolean }) => (
    <textarea aria-label="Raw output" value={value} readOnly={readOnly} />
  ),
}))

it('switches between readable workflow output with attachments and read-only raw output', async () => {
  const file: FileEntity = {
    id: 'file-1',
    name: 'report.txt',
    size: 128,
    type: 'text/plain',
    progress: 100,
    transferMethod: TransferMethod.remote_url,
    supportFileType: 'document',
    url: 'https://example.com/report.txt',
  }
  const data: WorkflowProcess = {
    status: WorkflowRunningStatus.Succeeded,
    tracing: [],
    resultText: 'Hello **world**',
    // ResultTab consumes the grouped runtime output; WorkflowProcess currently types files as a flat list.
    files: [{ varName: 'attachments', list: [file] }] as unknown as WorkflowProcess['files'],
  }
  const content = '{"answer":"ok"}'
  const { rerender } = render(<ResultTab currentTab="RESULT" content={content} data={data} />)
  expect(await screen.findByText('world')).toBeInTheDocument()
  expect(screen.getByText('attachments')).toBeInTheDocument()
  expect(screen.getByText('report.txt')).toBeInTheDocument()
  expect(screen.queryByRole('textbox')).not.toBeInTheDocument()
  rerender(<ResultTab currentTab="DETAIL" content={content} data={data} />)
  expect(screen.getByRole('textbox', { name: 'Raw output' })).toHaveValue(content)
  expect(screen.getByRole('textbox', { name: 'Raw output' })).toHaveAttribute('readonly')
  expect(screen.queryByText('attachments')).not.toBeInTheDocument()
})
