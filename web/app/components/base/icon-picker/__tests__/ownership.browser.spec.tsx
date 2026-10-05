import type { EmojiIcon } from '..'
import { Dialog, DialogContent, DialogTitle, DialogTrigger } from '@langgenius/dify-ui/dialog'
import {
  Drawer,
  DrawerBackdrop,
  DrawerContent,
  DrawerPopup,
  DrawerPortal,
  DrawerTitle,
  DrawerTrigger,
  DrawerViewport,
} from '@langgenius/dify-ui/drawer'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { useState } from 'react'
import { userEvent } from 'vite-plus/test/browser'
import { render } from 'vitest-browser-react'
import { IconPickerDialog } from '..'
import { emojiCatalogOptions } from '../emoji-data'

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

function NestedOwner({ kind, onSubmit }: { kind: 'dialog' | 'drawer'; onSubmit: () => void }) {
  const [value, setValue] = useState(initial)
  const content = (
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
  )
  if (kind === 'drawer') {
    return (
      <Drawer swipeDirection="right">
        <DrawerTrigger>Open owner</DrawerTrigger>
        <DrawerPortal>
          <DrawerBackdrop />
          <DrawerViewport>
            <DrawerPopup>
              <DrawerContent>
                <DrawerTitle>Owner</DrawerTitle>
                {content}
              </DrawerContent>
            </DrawerPopup>
          </DrawerViewport>
        </DrawerPortal>
      </Drawer>
    )
  }
  return (
    <Dialog>
      <DialogTrigger>Open owner</DialogTrigger>
      <DialogContent>
        <DialogTitle>Owner</DialogTitle>
        {content}
      </DialogContent>
    </Dialog>
  )
}

it.each(['dialog', 'drawer'] as const)(
  'confirms and dismisses only the nested picker inside a %s',
  async (kind) => {
    const client = createClient()
    const onSubmit = vi.fn()
    const screen = await render(
      <QueryClientProvider client={client}>
        <NestedOwner kind={kind} onSubmit={onSubmit} />
      </QueryClientProvider>,
    )
    const ownerTrigger = screen.getByRole('button', { name: 'Open owner' })
    await ownerTrigger.click()
    const owner = screen.getByRole('dialog', { name: 'Owner', exact: true })
    if (kind === 'drawer') {
      await expect.element(owner).toHaveFocus()
      await userEvent.tab()
    }
    await expect.element(owner.getByRole('textbox', { name: 'Owner name' })).toHaveFocus()
    await userEvent.tab()
    const trigger = screen.getByRole('button', { name: 'Choose icon' })
    await expect.element(trigger).toHaveFocus()
    await userEvent.keyboard('{Enter}')
    const picker = screen.getByRole('dialog', { name: 'app.iconPicker.title' })
    const search = picker.getByRole('combobox', { name: 'app.iconPicker.search' })
    await expect.element(search).toHaveFocus()
    await search.fill('Cool')
    await userEvent.keyboard('{ArrowDown}{Enter}')
    expect(onSubmit).not.toHaveBeenCalled()
    await picker.getByRole('button', { name: 'app.iconPicker.ok' }).click()
    await expect.element(picker).not.toBeInTheDocument()
    await expect.element(owner).toBeVisible()
    await expect.element(trigger).toHaveFocus()
    await expect.element(owner.getByRole('status', { name: 'Saved icon' })).toHaveTextContent('😎')
    await expect
      .element(owner.getByRole('textbox', { name: 'Owner name' }))
      .toHaveValue('Untouched')
    expect(onSubmit).not.toHaveBeenCalled()

    await userEvent.keyboard(' ')
    await expect.element(picker).toBeVisible()
    await userEvent.keyboard('{Escape}')
    await expect.element(picker).not.toBeInTheDocument()
    await expect.element(owner).toBeVisible()
    await expect.element(trigger).toHaveFocus()
    await userEvent.keyboard('{Escape}')
    await expect.element(owner).not.toBeInTheDocument()
    await expect.element(ownerTrigger).toHaveFocus()
    client.clear()
  },
)

function ObservedOwner({ show }: { show: boolean }) {
  const [pickerOpen, setPickerOpen] = useState(false)
  return (
    <>
      <output data-testid="picker-observation">{pickerOpen ? 'open' : 'closed'}</output>
      <Dialog open={show}>
        <DialogContent>
          <DialogTitle>Observed owner</DialogTitle>
          <IconPickerDialog
            aria-label="Choose icon"
            value={initial}
            onOpenChange={setPickerOpen}
            onConfirm={() => {}}
          />
        </DialogContent>
      </Dialog>
    </>
  )
}

it('clears the open observer when an external owner hides and opens a new picker session', async () => {
  const client = createClient()
  const view = (show: boolean) => (
    <QueryClientProvider client={client}>
      <ObservedOwner show={show} />
    </QueryClientProvider>
  )
  const screen = await render(view(true))
  const trigger = screen.getByRole('button', { name: 'Choose icon' })
  await trigger.click()
  const picker = screen.getByRole('dialog', { name: 'app.iconPicker.title' })
  await expect.element(picker).toBeVisible()
  await expect.element(screen.getByTestId('picker-observation')).toHaveTextContent('open')
  await screen.rerender(view(false))
  await expect.element(picker).not.toBeInTheDocument()
  await expect.element(screen.getByTestId('picker-observation')).toHaveTextContent('closed')
  await screen.rerender(view(true))
  await expect.element(trigger).toHaveFocus()
  await userEvent.keyboard('{Enter}')
  await expect
    .element(picker.getByRole('combobox', { name: 'app.iconPicker.search' }))
    .toHaveFocus()
  await expect.element(screen.getByTestId('picker-observation')).toHaveTextContent('open')
  await userEvent.keyboard('{Escape}')
  await expect.element(screen.getByTestId('picker-observation')).toHaveTextContent('closed')
  await expect.element(trigger).toHaveFocus()
  client.clear()
})
