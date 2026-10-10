import type { PostFilesUploadResponse } from '@dify/contracts/api/console/files/types.gen'
import type { EmojiIcon } from '..'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { useState } from 'react'
import { page, userEvent } from 'vite-plus/test/browser'
import { render } from 'vitest-browser-react'
import { emojiCatalogOptions } from '../emoji-data'
import { IconPickerDialog } from './harness'

const { uploadImage } = vi.hoisted(() => ({
  uploadImage: vi.fn<() => Promise<PostFilesUploadResponse>>(),
}))

vi.mock('@/service/console', () => ({
  consoleQuery: {
    files: { upload: { post: { mutationOptions: () => ({ mutationFn: uploadImage }) } } },
  },
}))

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
  const [value, setValue] = useState(initial)
  return (
    <>
      <output aria-label="Saved icon">{value.icon}</output>
      <IconPickerDialog
        aria-label="Choose"
        value={value}
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
  await expect.element(green).toHaveTextContent(chosen)
  await green.click()
  await input.fill('Face 0')
  await expect.poll(() => page.getByRole('gridcell').all().length).toBe(1)
  await userEvent.keyboard('{Enter}')
  const finalEmoji = '😀'
  await expect.element(green).toBeChecked()
  await clear.click()
  await expect.element(input).toHaveValue('')
  await expect.element(input).toHaveFocus()
  await expect.element(clear).not.toBeInTheDocument()
  await expect.poll(() => page.getByRole('gridcell').all().length).toBe(unfilteredCount)
  await expect.element(green).toBeChecked()
  await page.getByRole('button', { name: 'app.iconPicker.ok' }).click()
  await expect
    .element(page.getByRole('status', { name: 'Saved icon' }))
    .toHaveTextContent(finalEmoji)
  const trigger = page.getByRole('button', { name: 'Choose', exact: true })
  await expect.element(trigger).toHaveFocus()
  await trigger.click()
  await expect.element(input).toHaveValue('')
  await page.getByRole('button', { name: 'app.iconPicker.tryYourLuck' }).click()
  await userEvent.keyboard('{Escape}')
  await expect.element(page.getByRole('dialog')).not.toBeInTheDocument()
  await expect.element(trigger).toHaveFocus()
  await expect
    .element(page.getByRole('status', { name: 'Saved icon' }))
    .toHaveTextContent(finalEmoji)
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
        aria-label="Choose image"
        value={{
          type: 'image',
          fileId: 'image-id',
          url: 'data:image/svg+xml,<svg xmlns="http://www.w3.org/2000/svg"/>',
        }}
        onConfirm={() => {}}
      />
    </QueryClientProvider>,
  )
  await page.getByRole('button', { name: 'Choose image' }).click()
  await expect
    .element(page.getByRole('tab', { name: 'app.iconPicker.image' }))
    .toHaveAttribute('aria-selected', 'true')
  await expect.element(page.getByRole('button', { name: 'common.operation.change' })).toHaveFocus()
  client.clear()
})

it.each(['light', 'dark'])(
  'distinguishes keyboard focus from the selected color in %s mode',
  async (theme) => {
    document.documentElement.dataset.theme = theme
    const client = new QueryClient()
    client.setQueryData(emojiCatalogOptions.queryKey, [])
    try {
      await render(
        <QueryClientProvider client={client}>
          <Harness />
        </QueryClientProvider>,
      )
      await page.getByRole('button', { name: 'Choose', exact: true }).click()
      const red = page.getByRole('radio', { name: 'app.iconPicker.color.red' })
      const rose = page.getByRole('radio', { name: 'app.iconPicker.color.rose' })
      await expect.element(red).toBeChecked()
      expect(getComputedStyle(red.element()).outlineStyle).toBe('none')

      await userEvent.tab()
      await expect.element(red).toHaveFocus()
      expect(getComputedStyle(red.element()).outlineStyle).toBe('solid')
      expect(Number.parseFloat(getComputedStyle(red.element()).outlineWidth)).toBeGreaterThan(0)

      await userEvent.keyboard('{ArrowRight}')
      await expect.element(rose).toHaveFocus()
      await expect.element(rose).toBeChecked()
      expect(getComputedStyle(rose.element()).outlineStyle).toBe('solid')
      expect(getComputedStyle(red.element()).outlineStyle).toBe('none')

      await userEvent.tab()
      await expect
        .element(page.getByRole('button', { name: 'app.iconPicker.tryYourLuck' }))
        .toHaveFocus()
      await expect.element(rose).toBeChecked()
      expect(getComputedStyle(rose.element()).outlineStyle).toBe('none')
    } finally {
      document.documentElement.dataset.theme = 'light'
      client.clear()
    }
  },
)

it('discards the cancelled draft when reopened immediately from the keyboard', async () => {
  const client = new QueryClient()
  client.setQueryData(emojiCatalogOptions.queryKey, [])
  await render(
    <QueryClientProvider client={client}>
      <Harness />
    </QueryClientProvider>,
  )
  await page.getByRole('button', { name: 'Choose', exact: true }).click()
  await page.getByRole('radio', { name: 'app.iconPicker.color.green' }).click()
  await userEvent.keyboard('{Escape}{Enter}')
  await expect.element(page.getByRole('dialog', { name: 'app.iconPicker.title' })).toBeVisible()
  await expect.element(page.getByRole('radio', { name: 'app.iconPicker.color.red' })).toBeChecked()
  client.clear()
})

it('locks image editing during submission and restores it after failure', async () => {
  let rejectUpload!: (reason: Error) => void
  uploadImage.mockReturnValueOnce(
    new Promise((_, reject) => {
      rejectUpload = reject
    }),
  )
  const client = new QueryClient()
  client.setQueryData(emojiCatalogOptions.queryKey, [])
  await render(
    <QueryClientProvider client={client}>
      <Harness />
    </QueryClientProvider>,
  )
  await page.getByRole('button', { name: 'Choose', exact: true }).click()
  await page.getByRole('tab', { name: 'app.iconPicker.image' }).click()
  const canvas = document.createElement('canvas')
  canvas.width = 100
  canvas.height = 100
  canvas.getContext('2d')!.fillRect(0, 0, 100, 100)
  const blob = await new Promise<Blob>((resolve) =>
    canvas.toBlob((value) => resolve(value!), 'image/png'),
  )
  await page.getByTestId('image-input').upload(new File([blob], 'icon.png', { type: 'image/png' }))
  const crop = page.getByRole('group', { name: 'app.iconPicker.crop' })
  await expect.element(crop).toBeVisible()
  const cropElement = crop.element() as HTMLElement
  cropElement.focus()
  await expect.element(crop).toHaveFocus()
  const zoom = page.getByRole('slider', { name: 'app.iconPicker.zoom' })
  const change = page.getByRole('button', { name: 'common.operation.change' })
  await page.getByRole('button', { name: 'app.iconPicker.ok' }).click()
  await expect.poll(() => uploadImage.mock.calls.length).toBe(1)
  await expect.element(zoom).toBeDisabled()
  await expect.element(change).toBeDisabled()
  cropElement.focus()
  expect(document.activeElement).not.toBe(cropElement)
  const cancel = page.getByRole('button', { name: 'app.iconPicker.cancel' })
  await expect.element(cancel).toBeEnabled()
  rejectUpload(new Error('Upload failed'))
  await expect.element(page.getByRole('alert')).toBeVisible()
  await expect.element(zoom).toBeEnabled()
  await expect.element(change).toBeEnabled()
  cropElement.focus()
  await expect.element(crop).toHaveFocus()
  await userEvent.tab()
  await expect.element(zoom).toHaveFocus()
  await userEvent.keyboard('{ArrowRight}')
  await expect.element(page.getByRole('alert')).not.toBeInTheDocument()
  client.clear()
})
