import type { RenameDocumentPayload } from '../rename-document-dialog'
import { createDialogHandle } from '@langgenius/dify-ui/dialog'
import { userEvent } from 'vite-plus/test/browser'
import { render } from 'vitest-browser-react'
import { createConsoleQueryWrapper } from '@/test/console/query-data'
import { guardUnexpectedFetch } from '@/test/unexpected-fetch'
import Operations from '../operations'
import { RenameDocumentDialog } from '../rename-document-dialog'

vi.mock('@/next/navigation', () => ({ useRouter: () => ({ push: vi.fn() }) }))

it('returns focus to the document menu button after dismissing rename', async () => {
  onTestFinished(guardUnexpectedFetch())
  const handle = createDialogHandle<RenameDocumentPayload>()
  const { wrapper } = createConsoleQueryWrapper()
  const screen = await render(
    <>
      <Operations
        scene="detail"
        embeddingAvailable
        datasetId="dataset"
        detail={{ id: 'document', name: 'Source' }}
        canEdit
        canViewSettings={false}
        canDownload={false}
        canDelete={false}
        onDelete={vi.fn()}
        onUpdate={vi.fn()}
        renameDialog={handle}
      />
      <RenameDocumentDialog datasetId="dataset" handle={handle} onSaved={vi.fn()} />
    </>,
    { wrapper },
  )
  const more = screen.getByRole('button', { name: 'common.operation.more' })
  await more.click()
  await screen.getByRole('menuitem', { name: 'datasetDocuments.list.table.rename' }).click()
  await expect.element(screen.getByRole('dialog').getByRole('textbox')).toHaveValue('Source')
  await userEvent.keyboard('{Escape}')
  await expect.element(screen.getByRole('dialog')).not.toBeInTheDocument()
  await expect.element(more).toHaveFocus()
})
