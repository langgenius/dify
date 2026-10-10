import type { ReactNode } from 'react'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { TransferMethod } from '@/types/app'
import { FileItem } from '../file-uploader-in-chat-input/file-item'

let mockBasePath = ''
vi.mock('@/utils/var', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/utils/var')>()),
  get basePath() {
    return mockBasePath
  },
}))

vi.mock('../pdf-highlighter-adapter', () => ({
  PdfLoader: ({
    children,
    beforeLoad,
    workerSrc,
  }: {
    children: (doc: unknown) => ReactNode
    beforeLoad: ReactNode
    workerSrc: string
  }) => (
    <div data-testid="pdf-loader" data-worker-src={workerSrc}>
      {beforeLoad}
      {children({ numPages: 1 })}
    </div>
  ),
  PdfHighlighter: () => <div>PDF page</div>,
}))

const file = {
  id: 'pdf-1',
  name: 'document.pdf',
  type: 'application/pdf',
  size: 2048,
  progress: 100,
  transferMethod: TransferMethod.local_file,
  supportFileType: 'document',
  url: 'https://example.com/doc.pdf',
}

async function openPdf() {
  render(<FileItem file={file} canPreview />)
  fireEvent.click(screen.getByRole('button', { name: 'document.pdf' }))
  await screen.findByText('PDF page')
}

function scaleContainer() {
  return screen.getByTestId('pdf-loader').parentElement!
}

beforeEach(() => {
  mockBasePath = ''
})

it('provides a named preview while loading the PDF worker from the configured base path', async () => {
  mockBasePath = '/dify'
  await openPdf()
  expect(screen.getByRole('dialog', { name: 'document.pdf' })).toBeInTheDocument()
  expect(screen.getByTestId('pdf-loader')).toHaveAttribute(
    'data-worker-src',
    '/dify/pdf.worker.min.mjs',
  )
})

it('uses the root worker path without a deployment base path', async () => {
  await openPdf()
  expect(screen.getByTestId('pdf-loader')).toHaveAttribute('data-worker-src', '/pdf.worker.min.mjs')
})

it('zooms within its limits and starts again at the original scale after reopening', async () => {
  const user = userEvent.setup()
  await openPdf()
  const zoomIn = screen.getByRole('button', { name: 'common.operation.zoomIn' })
  const zoomOut = screen.getByRole('button', { name: 'common.operation.zoomOut' })
  await user.click(zoomIn)
  expect(scaleContainer()).toHaveStyle({ transform: 'scale(1.2)' })
  await user.click(zoomOut)
  expect(scaleContainer()).toHaveStyle({ transform: 'scale(1)' })
  for (let step = 0; step < 20; step++) fireEvent.click(zoomIn)
  expect(scaleContainer()).toHaveStyle({ transform: 'scale(15)' })
  for (let step = 0; step < 25; step++) fireEvent.click(zoomOut)
  expect(scaleContainer()).toHaveStyle({ transform: 'scale(0.5)' })
  await user.click(screen.getByRole('button', { name: 'common.operation.close' }))
  await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
  await user.click(screen.getByRole('button', { name: 'document.pdf' }))
  await screen.findByText('PDF page')
  expect(scaleContainer()).toHaveStyle({ transform: 'scale(1)' })
})

it('keeps popup-level zoom shortcuts working while Close has focus', async () => {
  const user = userEvent.setup()
  await openPdf()
  const close = screen.getByRole('button', { name: 'common.operation.close' })
  close.focus()
  await user.keyboard('{ArrowUp}')
  expect(scaleContainer()).toHaveStyle({ transform: 'scale(1.2)' })
  await user.keyboard('{ArrowDown}')
  expect(scaleContainer()).toHaveStyle({ transform: 'scale(1)' })
  await user.keyboard('{Escape}')
  await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
})
