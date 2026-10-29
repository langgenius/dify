import { screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, expect, it, vi } from 'vite-plus/test'
import { ChunkingMode } from '@/models/datasets'
import { renderWithConsoleQuery as render } from '@/test/console/query-data'
import { DocumentContext } from '../../context'
import { SegmentDetail } from '../segment-detail'

vi.mock('@/context/dataset-detail', () => ({
  useDatasetDetailContextWithSelector: (
    selector: (state: { dataset: { indexing_technique: string; runtime_mode: string } }) => unknown,
  ) => selector({ dataset: { indexing_technique: 'high_quality', runtime_mode: 'general' } }),
}))

vi.mock('../index', () => ({
  useSegmentListContext: (selector: (state: { fullScreen: boolean }) => unknown) =>
    selector({ fullScreen: false }),
}))

vi.mock('@/app/components/base/markdown', () => ({
  Markdown: ({ content }: { content: string }) => <div>{content}</div>,
}))

vi.mock('@/app/components/datasets/common/image-uploader/image-uploader-in-chunk', () => ({
  default: () => null,
}))

const onUpdate = vi.fn()
const content = '![image](/files/image-id/file-preview)'
const signContent = '![image](/files/image-id/file-preview?timestamp=123&sign=signed)'

function detail(canEdit: boolean, docForm: ChunkingMode = ChunkingMode.text) {
  return (
    // oxlint-disable-next-line eslint-react/no-context-provider -- use-context-selector contexts are not React 19 context components.
    <DocumentContext.Provider value={{ canEdit, docForm, parentMode: 'paragraph' }}>
      <SegmentDetail
        segInfo={{ id: 'segment-1', content, sign_content: signContent, word_count: 40 }}
        onUpdate={onUpdate}
        onCancel={vi.fn()}
        isEditMode
        docForm={docForm}
      />
    </DocumentContext.Provider>
  )
}

beforeEach(() => {
  vi.clearAllMocks()
})

it('preserves raw content for saving after permission changes from read-only to editable', async () => {
  const user = userEvent.setup()
  const { rerender } = render(detail(false))
  expect(screen.getByText(signContent)).toBeInTheDocument()
  rerender(detail(true))
  await user.click(await screen.findByRole('button', { name: /common.operation.save/ }))
  expect(onUpdate).toHaveBeenCalledWith('segment-1', content, '', [], [], '', false)
})

it('closes the regeneration confirmation when edit permission is revoked', async () => {
  const user = userEvent.setup()
  const { rerender } = render(detail(true, ChunkingMode.parentChild))
  await user.click(screen.getByRole('button', { name: 'common.operation.saveAndRegenerate' }))
  expect(await screen.findByRole('alertdialog')).toBeInTheDocument()

  rerender(detail(false, ChunkingMode.parentChild))

  await waitFor(() => expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument())
  expect(screen.queryByRole('button', { name: /common.operation.save/ })).not.toBeInTheDocument()
  expect(onUpdate).not.toHaveBeenCalled()
})
