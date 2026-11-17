import type { ConversationHistoriesRole } from '@/models/debug'
import { useState } from 'react'
import { render } from 'vitest-browser-react'
import EditModal from '../edit-modal'

function PrefixEditor() {
  const [open, setOpen] = useState(true)
  const [saved, setSaved] = useState<ConversationHistoriesRole>({
    user_prefix: 'user',
    assistant_prefix: 'assistant',
  })
  return (
    <>
      <EditModal
        isShow={open}
        saveLoading={false}
        data={saved}
        onClose={() => setOpen(false)}
        onSave={(value: ConversationHistoriesRole) => {
          setSaved(value)
          setOpen(false)
        }}
      />
      <section aria-label="Saved prefixes">
        <p>{saved.user_prefix}</p>
        <p>{saved.assistant_prefix}</p>
      </section>
    </>
  )
}

it('commits both edited prefixes and closes the dialog', async () => {
  const screen = await render(<PrefixEditor />)
  const dialog = screen.getByRole('dialog')
  // These legacy inputs have visible captions but no associated labels; use their textbox roles.
  await dialog.getByRole('textbox').nth(0).fill('member')
  await dialog.getByRole('textbox').nth(1).fill('helper')
  await dialog.getByRole('button', { name: 'common.operation.save' }).click()
  await expect.element(dialog).not.toBeInTheDocument()
  const saved = screen.getByRole('region', { name: 'Saved prefixes' })
  await expect.element(saved.getByText('member')).toBeVisible()
  await expect.element(saved.getByText('helper')).toBeVisible()
})

it('closes on cancellation and leaves the saved prefixes unchanged', async () => {
  const screen = await render(<PrefixEditor />)
  const dialog = screen.getByRole('dialog')
  await dialog.getByRole('textbox').nth(0).fill('Discarded prefix')
  await dialog.getByRole('button', { name: 'common.operation.cancel' }).click()
  await expect.element(dialog).not.toBeInTheDocument()
  const saved = screen.getByRole('region', { name: 'Saved prefixes' })
  await expect.element(saved.getByText('user')).toBeVisible()
  await expect.element(saved.getByText('assistant')).toBeVisible()
  await expect.element(screen.getByText('Discarded prefix')).not.toBeInTheDocument()
})
