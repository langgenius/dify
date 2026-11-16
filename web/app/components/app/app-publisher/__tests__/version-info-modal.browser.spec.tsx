import { useState } from 'react'
import { userEvent } from 'vite-plus/test/browser'
import { render } from 'vitest-browser-react'
import { AppToaster } from '@/app/notifications/app-toaster'
import VersionInfoModal from '../version-info-modal'

function ReleaseEditor() {
  const [open, setOpen] = useState(true)
  const [published, setPublished] = useState<{ title: string; releaseNotes: string; id?: string }>()
  return (
    <>
      <VersionInfoModal
        isOpen={open}
        versionInfo={{ id: 'version-3', marked_name: 'Old title', marked_comment: 'Old notes' }}
        onClose={() => setOpen(false)}
        onPublish={setPublished}
      />
      {published && (
        <section aria-label="Published version">
          <h2>{published.title}</h2>
          <p>{published.releaseNotes}</p>
          <p>{published.id}</p>
        </section>
      )}
      <AppToaster />
    </>
  )
}

it('keeps invalid release metadata open and publishes the corrected title and notes', async () => {
  const screen = await render(<ReleaseEditor />)
  const title = screen.getByRole('textbox', { name: /editField\.title$/ })
  const notes = screen.getByRole('textbox', { name: /editField\.releaseNotes$/ })
  const save = screen.getByRole('button', { name: 'common.operation.save' })
  await expect.element(title).toHaveValue('Old title')
  await expect.element(notes).toHaveValue('Old notes')
  await title.fill('a'.repeat(16))
  await save.click()
  await expect.element(title).toHaveAttribute('aria-invalid', 'true')
  await expect
    .element(screen.getByText(/versionHistory\.editField\.titleLengthLimit/))
    .toBeVisible()
  await expect.element(screen.getByRole('dialog')).toBeVisible()
  await expect
    .element(screen.getByRole('region', { name: 'Published version' }))
    .not.toBeInTheDocument()

  await title.fill('Release 3')
  await notes.fill('b'.repeat(101))
  await save.click()
  await expect.element(title).not.toHaveAttribute('aria-invalid', 'true')
  await expect.element(notes).toHaveAttribute('aria-invalid', 'true')
  await expect
    .element(screen.getByText(/versionHistory\.editField\.releaseNotesLengthLimit/))
    .toBeVisible()
  await expect.element(screen.getByRole('dialog')).toBeVisible()
  await expect
    .element(screen.getByRole('region', { name: 'Published version' }))
    .not.toBeInTheDocument()

  await notes.fill('Stable release notes')
  await save.click()
  await expect.element(screen.getByRole('dialog')).not.toBeInTheDocument()
  const published = screen.getByRole('region', { name: 'Published version' })
  await expect.element(published.getByRole('heading', { name: 'Release 3' })).toBeVisible()
  await expect.element(published.getByText('Stable release notes')).toBeVisible()
  await expect.element(published.getByText('version-3')).toBeVisible()
})

it('dismisses an edited release without publishing it', async () => {
  const screen = await render(<ReleaseEditor />)
  await screen.getByRole('textbox', { name: /editField\.title$/ }).fill('Unsaved title')
  await userEvent.keyboard('{Escape}')
  await expect.element(screen.getByRole('dialog')).not.toBeInTheDocument()
  await expect
    .element(screen.getByRole('region', { name: 'Published version' }))
    .not.toBeInTheDocument()
})
