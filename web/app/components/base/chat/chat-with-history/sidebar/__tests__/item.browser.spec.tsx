import type { ConversationItem } from '@/models/share'
import { useState } from 'react'
import { page, userEvent } from 'vite-plus/test/browser'
import { render } from 'vitest-browser-react'
import Item from '../item'

const first: ConversationItem = {
  id: 'conversation-1',
  name: 'First conversation',
  inputs: {},
  introduction: '',
}
const second: ConversationItem = { ...first, id: 'conversation-2', name: 'Second conversation' }

function SelectionOwner({ item = first }: { item?: ConversationItem }) {
  const [selected, setSelected] = useState('other')
  return (
    <>
      <Item
        item={item}
        currentConversationId={selected}
        onChangeConversation={setSelected}
        onOperate={() => {}}
      />
      <output aria-label="Selected conversation">{selected}</output>
    </>
  )
}

beforeEach(async () => {
  await page.viewport(400, 400)
})

it('selects a conversation with the pointer', async () => {
  await render(<SelectionOwner />)
  const selection = page.getByRole('status', { name: 'Selected conversation' })
  const firstRow = page.getByRole('button', { name: first.name })
  await firstRow.click()
  await expect.element(selection).toHaveTextContent(first.id)
})

it('selects a conversation with native keyboard activation', async () => {
  const view = await render(<SelectionOwner />)
  const firstRow = page.getByRole('button', { name: first.name })
  await expect.element(firstRow).toBeVisible()

  await view.rerender(<SelectionOwner item={second} />)
  await expect.element(firstRow).not.toBeInTheDocument()
  const nextRow = page.getByRole('button', { name: second.name })
  await expect.element(nextRow).toBeVisible()
  // Establish the row as the keyboard starting point, then use native activation.
  nextRow.element().focus()
  await userEvent.keyboard('{Enter}')
  await expect
    .element(page.getByRole('status', { name: 'Selected conversation' }))
    .toHaveTextContent(second.id)
})

it('selects an unsaved conversation without offering server operations', async () => {
  await render(<SelectionOwner item={{ ...first, id: '' }} />)
  await page.getByRole('button', { name: first.name }).click()
  await expect
    .element(page.getByRole('status', { name: 'Selected conversation' }))
    .toHaveTextContent('')
  await expect
    .element(page.getByRole('button', { name: 'common.operation.more' }))
    .not.toBeInTheDocument()
})

it('reveals operations to keyboard focus and returns focus after dismissing the menu', async () => {
  await render(<SelectionOwner />)
  // Keep the pointer outside the row so hover cannot mask broken keyboard disclosure.
  await page.getByRole('status', { name: 'Selected conversation' }).hover()
  const more = page.getByRole('button', { name: 'common.operation.more' })
  await expect.element(more).toBeInTheDocument()
  // Browser visibility matching includes transparent elements; keyboard disclosure must paint it.
  await expect.poll(() => getComputedStyle(more.element()).opacity).toBe('0')
  await userEvent.tab()
  await expect.element(page.getByRole('button', { name: first.name })).toHaveFocus()
  await userEvent.tab()
  await expect.element(more).toHaveFocus()
  await expect.poll(() => Number(getComputedStyle(more.element()).opacity)).toBeGreaterThan(0)
  await expect.element(more).toBeVisible()
  await userEvent.keyboard('{Enter}')
  const menu = page.getByRole('menu')
  await expect.element(menu).toBeVisible()
  await userEvent.keyboard('{Escape}')
  await expect.element(menu).not.toBeInTheDocument()
  await expect.element(more).toHaveFocus()
  await expect
    .element(page.getByRole('status', { name: 'Selected conversation' }))
    .toHaveTextContent('other')
})

it('keeps an opened menu usable when the pointer leaves the conversation row', async () => {
  await render(<SelectionOwner />)
  await page.getByRole('status', { name: 'Selected conversation' }).hover()
  const more = page.getByRole('button', { name: 'common.operation.more' })
  await expect.element(more).toBeInTheDocument()
  await expect.poll(() => getComputedStyle(more.element()).opacity).toBe('0')
  await page.getByRole('button', { name: first.name }).hover()
  await expect.poll(() => Number(getComputedStyle(more.element()).opacity)).toBeGreaterThan(0)
  await more.click()
  const menu = page.getByRole('menu')
  await expect.element(menu).toBeVisible()
  await page.getByRole('menuitem', { name: 'explore.sidebar.action.pin' }).hover()
  await expect.element(more).toHaveAttribute('aria-expanded', 'true')
  await expect.element(more).toBeVisible()
  await userEvent.keyboard('{Escape}')
  await expect.element(menu).not.toBeInTheDocument()
  await expect
    .element(page.getByRole('status', { name: 'Selected conversation' }))
    .toHaveTextContent('other')
})
