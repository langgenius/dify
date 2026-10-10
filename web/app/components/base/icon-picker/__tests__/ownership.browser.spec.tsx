import type { EmojiIcon } from '..'
import { Dialog, DialogContent, DialogTitle, DialogTrigger } from '@langgenius/dify-ui/dialog'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { useState } from 'react'
import { userEvent } from 'vite-plus/test/browser'
import { render } from 'vitest-browser-react'
import { emojiCatalogOptions } from '../emoji-data'
import { IconPickerDialog } from './harness'

vi.mock('@/service/console', () => ({
  consoleQuery: {
    files: { upload: { post: { mutationOptions: () => ({ mutationFn: vi.fn() }) } } },
  },
}))
vi.mock('@/next/navigation', () => ({ useParams: () => ({}) }))

const initial: EmojiIcon = { type: 'emoji', icon: '😀', background: '#FEF3F2' }

function createClient() {
  const client = new QueryClient()
  client.setQueryData(emojiCatalogOptions.queryKey, [
    {
      id: 'faces',
      label: 'Faces',
      items: [{ emoji: '😎', label: 'Cool face', version: 1 }],
    },
  ])
  return client
}

function NestedOwner({ onSubmit }: { onSubmit: () => void }) {
  const [value, setValue] = useState(initial)
  return (
    <Dialog>
      <DialogTrigger>Open owner</DialogTrigger>
      <DialogContent>
        <DialogTitle>Owner</DialogTitle>
        <form
          onSubmit={(event) => {
            event.preventDefault()
            onSubmit()
          }}
        >
          <label>
            Owner name
            <input defaultValue="Untouched" />
          </label>
          <IconPickerDialog
            aria-label="Choose icon"
            value={value}
            enableImageUpload={false}
            onConfirm={(next) => {
              if (next.type === 'emoji') setValue(next)
            }}
          />
          <output aria-label="Saved icon">{value.icon}</output>
          <button type="submit">Save owner</button>
        </form>
      </DialogContent>
    </Dialog>
  )
}

it('confirms and dismisses only the nested picker inside a dialog', async () => {
  const client = createClient()
  const onSubmit = vi.fn()
  const screen = await render(
    <QueryClientProvider client={client}>
      <NestedOwner onSubmit={onSubmit} />
    </QueryClientProvider>,
  )
  await screen.getByRole('button', { name: 'Open owner' }).click()
  const owner = screen.getByRole('dialog', { name: 'Owner', exact: true })
  await expect.element(owner.getByRole('textbox', { name: 'Owner name' })).toHaveFocus()
  await userEvent.tab()
  const trigger = screen.getByRole('button', { name: 'Choose icon' })
  await expect.element(trigger).toHaveFocus()
  await userEvent.keyboard('{Enter}')
  const picker = screen.getByRole('dialog', { name: 'app.iconPicker.title' })
  const search = picker.getByRole('combobox', { name: 'app.iconPicker.search' })
  await expect.element(search).toHaveFocus()
  await search.fill('Cool')
  const candidate = picker.getByRole('gridcell', { name: 'Cool face' })
  await expect.element(candidate).toBeVisible()
  await userEvent.keyboard('{ArrowDown}')
  await expect.element(search).toHaveAttribute('aria-activedescendant', candidate.element().id)
  await userEvent.keyboard('{Enter}')
  expect(onSubmit).not.toHaveBeenCalled()
  await picker.getByRole('button', { name: 'app.iconPicker.ok' }).click()
  await expect.element(picker).not.toBeInTheDocument()
  await expect.element(owner).toBeVisible()
  await expect.element(trigger).toHaveFocus()
  await expect.element(owner.getByRole('status', { name: 'Saved icon' })).toHaveTextContent('😎')
  await expect.element(owner.getByRole('textbox', { name: 'Owner name' })).toHaveValue('Untouched')
  expect(onSubmit).not.toHaveBeenCalled()

  await userEvent.keyboard(' ')
  await expect.element(picker).toBeVisible()
  await userEvent.keyboard('{Escape}')
  await expect.element(picker).not.toBeInTheDocument()
  await expect.element(owner).toBeVisible()
  client.clear()
})
