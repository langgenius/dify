import type { EmojiIcon } from '..'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { useState } from 'react'
import { page, userEvent } from 'vite-plus/test/browser'
import { render } from 'vitest-browser-react'
import { IconPickerDialog } from '..'
import { emojiCatalogOptions } from '../emoji-data'

vi.mock('@/next/navigation', () => ({ useParams: () => ({}) }))

const emojis = [
  '😀',
  '😃',
  '😄',
  '😁',
  '😆',
  '😅',
  '😂',
  '🤣',
  '🥲',
  '☺️',
  '😊',
  '😇',
  '🙂',
  '😍',
  '😘',
  '😙',
  '😝',
  '🤪',
  '🤓',
  '😎',
]
const initial: EmojiIcon = { type: 'emoji', icon: '😀', background: '#FEF3F2' }

function Harness() {
  const [open, setOpen] = useState(false)
  const [value, setValue] = useState(initial)
  return (
    <>
      <button type="button" onClick={() => setOpen(true)}>
        Choose
      </button>
      <output aria-label="Saved icon">{value.icon}</output>
      <IconPickerDialog
        open={open}
        onOpenChange={setOpen}
        defaultValue={value}
        onConfirm={(next) => {
          if (next.type === 'emoji') setValue(next)
        }}
      />
    </>
  )
}

it('navigates a visible candidate after filtering, confirms with Enter, and discards cancelled drafts', async () => {
  const client = new QueryClient()
  client.setQueryData(emojiCatalogOptions.queryKey, [
    {
      id: 'faces',
      label: 'Faces',
      items: emojis.map((emoji, index) => ({ emoji, label: `Face ${index}`, version: 1 })),
    },
  ])
  await render(
    <QueryClientProvider client={client}>
      <Harness />
    </QueryClientProvider>,
  )
  await page.getByRole('button', { name: 'Choose', exact: true }).click()
  await expect.element(page.getByRole('dialog', { name: 'app.iconPicker.title' })).toBeVisible()
  await expect.element(page.getByRole('tabpanel', { name: 'app.iconPicker.emoji' })).toBeVisible()
  await expect
    .element(page.getByRole('radiogroup', { name: 'app.iconPicker.chooseStyle' }))
    .toBeVisible()
  const input = page.getByRole('combobox', { name: 'app.iconPicker.search' })
  await expect.element(input).toHaveFocus()
  const clear = page.getByRole('button', { name: 'app.iconPicker.clearSearch' })
  await expect.element(clear).not.toBeInTheDocument()
  const unfilteredCount = page.getByRole('gridcell').all().length
  await input.fill('Face')
  await expect.poll(() => page.getByRole('gridcell').all().length).toBe(20)
  await userEvent.keyboard('{ArrowDown}{ArrowRight}')
  const activeId = input.element().getAttribute('aria-activedescendant')!
  const active = document.getElementById(activeId)!
  expect(active).not.toBeNull()
  const style = getComputedStyle(active)
  const inactive = page
    .getByRole('gridcell')
    .all()
    .find((cell) => cell.element() !== active)!
  expect(style.backgroundColor).not.toBe(getComputedStyle(inactive.element()).backgroundColor)
  const keyboardBackground = style.backgroundColor
  await inactive.hover()
  await expect.element(input).toHaveAttribute('aria-activedescendant', inactive.element().id)
  expect(getComputedStyle(inactive.element()).backgroundColor).toBe(keyboardBackground)
  expect(document.querySelectorAll('[role="gridcell"][data-highlighted]')).toHaveLength(1)
  await userEvent.keyboard('{ArrowDown}')
  const keyboardCandidate = document.getElementById(
    input.element().getAttribute('aria-activedescendant')!,
  )!
  expect(keyboardCandidate).not.toBe(inactive.element())
  expect(getComputedStyle(keyboardCandidate).backgroundColor).toBe(keyboardBackground)
  expect(getComputedStyle(inactive.element()).backgroundColor).toBe('rgba(0, 0, 0, 0)')
  const chosen = keyboardCandidate.textContent!
  await userEvent.keyboard('{Enter}')
  await expect.element(input).toHaveValue('Face')
  const green = page.getByRole('radio', { name: 'app.iconPicker.color.green' })
  await green.click()
  await input.fill('Face 0')
  await expect.poll(() => page.getByRole('gridcell').all().length).toBe(1)
  await clear.click()
  await expect.element(input).toHaveValue('')
  await expect.element(input).toHaveFocus()
  await expect.element(clear).not.toBeInTheDocument()
  await expect.poll(() => page.getByRole('gridcell').all().length).toBe(unfilteredCount)
  await expect.element(green).toBeChecked()
  await page.getByRole('button', { name: 'app.iconPicker.ok' }).click()
  await expect.element(page.getByRole('status', { name: 'Saved icon' })).toHaveTextContent(chosen)
  const trigger = page.getByRole('button', { name: 'Choose', exact: true })
  await expect.element(trigger).toHaveFocus()
  await trigger.click()
  await expect.element(input).toHaveValue('')
  await page.getByRole('button', { name: 'app.iconPicker.tryYourLuck' }).click()
  await userEvent.keyboard('{Escape}')
  await expect.element(page.getByRole('dialog')).not.toBeInTheDocument()
  await expect.element(trigger).toHaveFocus()
  await expect.element(page.getByRole('status', { name: 'Saved icon' })).toHaveTextContent(chosen)
  await trigger.click()
  await expect
    .element(page.getByRole('radio', { name: 'app.iconPicker.color.green' }))
    .toBeChecked()
  client.clear()
})

it('focuses the visible image action when reopening an existing image icon', async () => {
  const client = new QueryClient()
  client.setQueryData(emojiCatalogOptions.queryKey, [])
  await render(
    <QueryClientProvider client={client}>
      <IconPickerDialog
        open
        defaultValue={{
          type: 'image',
          fileId: 'image-id',
          url: 'data:image/svg+xml,<svg xmlns="http://www.w3.org/2000/svg"/>',
        }}
        onOpenChange={() => {}}
        onConfirm={() => {}}
      />
    </QueryClientProvider>,
  )
  await expect
    .element(page.getByRole('tab', { name: 'app.iconPicker.image' }))
    .toHaveAttribute('aria-selected', 'true')
  await expect.element(page.getByRole('button', { name: 'common.operation.change' })).toHaveFocus()
  client.clear()
})
