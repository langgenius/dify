import { page, userEvent } from 'vite-plus/test/browser'
import { createDeferred } from '@/test/deferred'
import { setupSidebarBrowser } from './sidebar-browser-fixture'

const {
  conversationHistory,
  conversationLists,
  conversations,
  conversationsRoute,
  currentConversation,
  deleteRoute,
  noBranding,
  openOperations,
  operate,
  pinnedConversations,
  pinRoute,
  renderSidebar,
  renameRoute,
  selectedConversation,
  unpinRoute,
} = setupSidebarBrowser()

it('selects conversations from both lists and persists the visible result', async () => {
  await renderSidebar({}, noBranding, true)
  await expect.element(page.getByText('share.chat.pinnedTitle')).toBeVisible()
  await expect.element(page.getByText('share.chat.unpinnedTitle')).toBeVisible()
  await conversationHistory().getByRole('button', { name: 'Second conversation' }).click()
  await expect
    .element(currentConversation().getByRole('button', { name: 'Second conversation' }))
    .toBeVisible()
  expect(selectedConversation()).toBe('2')
  await conversationHistory().getByRole('button', { name: 'Pinned conversation' }).click()
  await expect
    .element(currentConversation().getByRole('button', { name: 'Pinned conversation' }))
    .toBeVisible()
  expect(selectedConversation()).toBe('p1')
})

it('applies pin changes without changing the selected conversation', async () => {
  await renderSidebar({ currentConversationId: 'p1' }, noBranding, true)
  await expect
    .element(currentConversation().getByRole('button', { name: 'Pinned conversation' }))
    .toBeVisible()
  conversationsRoute().mockImplementation(
    conversationLists([...pinnedConversations, conversations[0]!], [conversations[1]!]),
  )
  await operate('First conversation', 'pin')
  await expect.element(page.getByRole('menu')).not.toBeInTheDocument()
  await expect
    .poll(pinRoute)
    .toHaveBeenCalledExactlyOnceWith(expect.objectContaining({ params: { id: '1' } }))
  // Wait for the refreshed lists so the row is not moved while its operations are opened.
  await expect
    .poll(() => conversationHistory().element().textContent)
    .toMatch(/pinnedTitle.*Pinned conversation.*First conversation.*unpinnedTitle.*Second/)
  await openOperations('First conversation')
  await expect
    .element(page.getByRole('menuitem', { name: 'explore.sidebar.action.unpin' }))
    .toBeVisible()
  await userEvent.keyboard('{Escape}')
  await expect.element(page.getByRole('menu')).not.toBeInTheDocument()
  conversationsRoute().mockImplementation(
    conversationLists([conversations[0]!], [conversations[1]!, ...pinnedConversations]),
  )
  await operate('Pinned conversation', 'unpin')
  await expect.element(page.getByRole('menu')).not.toBeInTheDocument()
  await expect
    .poll(unpinRoute)
    .toHaveBeenCalledExactlyOnceWith(expect.objectContaining({ params: { id: 'p1' } }))
  await expect
    .poll(() => conversationHistory().element().textContent)
    .toMatch(/pinnedTitle.*First conversation.*unpinnedTitle.*Second.*Pinned conversation/)
  await openOperations('Pinned conversation')
  await expect
    .element(page.getByRole('menuitem', { name: 'explore.sidebar.action.pin' }))
    .toBeVisible()
  await userEvent.keyboard('{Escape}')
  await expect.element(page.getByRole('menu')).not.toBeInTheDocument()
  await expect
    .element(currentConversation().getByRole('button', { name: 'Pinned conversation' }))
    .toBeVisible()
  expect(selectedConversation()).toBe('p1')
})

it('enables a new conversation after the caller finishes generating a response', async () => {
  const view = await renderSidebar(
    {
      ownerProps: { isResponding: true },
      conversations: [],
      pinnedConversations: [],
    },
    noBranding,
    true,
  )
  const newChat = page.getByRole('button', { name: 'share.chat.newChat' })
  await expect.element(newChat).toBeDisabled()
  expect(selectedConversation()).toBe('1')
  await expect.element(page.getByText('share.chat.pinnedTitle')).not.toBeInTheDocument()
  await expect.element(page.getByText('share.chat.unpinnedTitle')).not.toBeInTheDocument()
  await view.updateDisplay({ isResponding: false })
  await expect.element(newChat).toBeEnabled()
  await newChat.click()
  await expect
    .element(conversationHistory().getByRole('button', { name: 'share.chat.newChatDefaultName' }))
    .toBeVisible()
  await expect.element(currentConversation().getByText('Test App')).toBeVisible()
  expect(selectedConversation()).toBe('')
})

it('persists desktop collapse and expansion through the live owner', async () => {
  await renderSidebar({ sidebarCollapsed: false })
  await page.getByRole('button', { name: 'layout.sidebar.collapseSidebar' }).click()
  const expand = page.getByRole('button', { name: 'layout.sidebar.expandSidebar' })
  await expect.element(expand).toBeVisible()
  expect(localStorage.getItem('webappSidebarCollapse')).toBe('collapsed')
  await expand.click()
  await expect
    .element(page.getByRole('button', { name: 'layout.sidebar.collapseSidebar' }))
    .toBeVisible()
  expect(localStorage.getItem('webappSidebarCollapse')).toBe('expanded')
})

it('keeps desktop collapse actions out of the mobile sidebar', async () => {
  await page.viewport(390, 700)
  await renderSidebar({ ownerProps: { isBelowSm: true } })
  await expect
    .element(page.getByRole('button', { name: /layout.sidebar.(expand|collapse)Sidebar/ }))
    .not.toBeInTheDocument()
  await expect.element(page.getByRole('button', { name: 'share.chat.newChat' })).toBeVisible()
})

it('keeps the chosen conversation until deletion succeeds, then removes its dialog and row', async () => {
  const pending = createDeferred<unknown>()
  deleteRoute().mockReturnValueOnce(pending.promise)
  await renderSidebar({ currentConversationId: '2' }, noBranding, true)
  await expect
    .element(currentConversation().getByRole('button', { name: 'Second conversation' }))
    .toBeVisible()
  await operate('Second conversation', 'delete')
  const dialog = page.getByRole('alertdialog', { name: 'share.chat.deleteConversation.title' })
  await expect.element(dialog).toBeVisible()
  expect(deleteRoute()).not.toHaveBeenCalled()
  await dialog.getByRole('button', { name: 'common.operation.confirm' }).click()
  await expect
    .poll(deleteRoute)
    .toHaveBeenCalledExactlyOnceWith(expect.objectContaining({ params: { id: '2' } }))
  await expect.element(dialog).toBeVisible()
  expect(selectedConversation()).toBe('2')
  conversationsRoute().mockImplementation(
    conversationLists(pinnedConversations, [conversations[0]!]),
  )
  pending.resolve({ result: 'success' })
  await expect.element(dialog).not.toBeInTheDocument()
  await expect
    .element(conversationHistory().getByRole('button', { name: 'Second conversation' }))
    .not.toBeInTheDocument()
  await expect
    .element(conversationHistory().getByRole('button', { name: 'share.chat.newChatDefaultName' }))
    .toBeVisible()
  await expect.element(currentConversation().getByText('Test App')).toBeVisible()
  expect(selectedConversation()).toBe('')
})

it('cancels deletion without changing the conversation', async () => {
  await renderSidebar({}, noBranding, true)
  await operate('First conversation', 'delete')
  const dialog = page.getByRole('alertdialog', { name: 'share.chat.deleteConversation.title' })
  await dialog.getByRole('button', { name: 'common.operation.cancel' }).click()
  await expect.element(dialog).not.toBeInTheDocument()
  expect(deleteRoute()).not.toHaveBeenCalled()
  await expect
    .element(currentConversation().getByRole('button', { name: 'First conversation' }))
    .toBeVisible()
  await expect
    .element(conversationHistory().getByRole('button', { name: 'First conversation' }))
    .toBeVisible()
  expect(selectedConversation()).toBe('1')
})

it('submits the chosen conversation name and blocks native Enter and click resubmission until saved', async () => {
  const pending = createDeferred<unknown>()
  renameRoute().mockReturnValueOnce(pending.promise)
  await renderSidebar({}, noBranding, true)
  await operate('Second conversation', 'rename')
  const input = page.getByRole('textbox', { name: 'common.chat.conversationName' })
  await expect.element(input).toHaveValue('Second conversation')
  await expect.element(input).toHaveFocus()
  await input.fill('New name')
  await userEvent.keyboard('{Enter}')
  await expect.poll(renameRoute).toHaveBeenCalledExactlyOnceWith(
    expect.objectContaining({
      params: { id: '2' },
      body: expect.objectContaining({ name: 'New name' }),
    }),
  )
  const save = page.getByRole('button', { name: 'common.operation.save' })
  await expect.element(save).toHaveAttribute('aria-disabled', 'true')
  await userEvent.tab()
  await userEvent.tab()
  await expect.element(save).toHaveFocus()
  await userEvent.keyboard(' ')
  await input.click()
  await userEvent.keyboard('{Enter}')
  expect(renameRoute()).toHaveBeenCalledTimes(1)
  pending.resolve({ result: 'success' })
  await expect.element(page.getByRole('dialog')).not.toBeInTheDocument()
  await expect.element(page.getByRole('button', { name: 'New name' })).toBeVisible()
  await expect
    .element(page.getByRole('button', { name: 'Second conversation' }))
    .not.toBeInTheDocument()
  await expect
    .element(currentConversation().getByRole('button', { name: 'First conversation' }))
    .toBeVisible()
  await expect
    .element(conversationHistory().getByRole('button', { name: 'First conversation' }))
    .toBeVisible()
  expect(selectedConversation()).toBe('1')
})

it('discards a cancelled rename before opening another conversation', async () => {
  await renderSidebar()
  await operate('First conversation', 'rename')
  const input = page.getByRole('textbox', { name: 'common.chat.conversationName' })
  await input.fill('First conversation unsaved')
  await page.getByRole('button', { name: 'common.operation.cancel' }).click()
  await expect.element(page.getByRole('dialog')).not.toBeInTheDocument()
  await operate('Second conversation', 'rename')
  await expect.element(input).toHaveValue('Second conversation')
  await expect.element(input).toHaveFocus()
  expect(renameRoute()).not.toHaveBeenCalled()
})
