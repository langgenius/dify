import type { KnowledgeFsSpaceListItemResponse } from '@dify/contracts/api/console/knowledge-fs/types.gen'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { userEvent } from 'vite-plus/test/browser'
import { render } from 'vitest-browser-react'
import { consoleQuery } from '@/service/console'
import { KnowledgeSpaceCard } from '../knowledge-space-card'

vi.mock('@/context/permission-state', async () => {
  const { atom } = await import('jotai')
  return { workspacePermissionKeysAtom: atom([]) }
})

const knowledgeSpace: KnowledgeFsSpaceListItemResponse = {
  control_space_id: 'space-1',
  created_at: '2026-07-15T00:00:00Z',
  knowledge_space_id: 'space-1',
  linked_apps: 2,
  owner_account_id: 'account-1',
  permission_keys: ['knowledge_space_read', 'knowledge_space_edit', 'knowledge_space_delete'],
  resource_version: 1,
  state: 'active',
  tags: [{ id: 'tag-1', name: 'Support' }],
  technical_status: 'available',
  technical_summary: {
    description: 'Answers for customer support and onboarding questions',
    document_count: 12,
    icon: null,
    knowledge_space_id: 'space-1',
    name: 'A knowledge base name long enough to be truncated inside the card heading',
    revision: 1,
    slug: 'support',
  },
  updated_at: '2026-07-18T00:00:00Z',
  visibility: 'only_me',
}

const renderCard = async () => {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false, staleTime: Infinity } },
  })
  queryClient.setQueryData(
    consoleQuery.tags.get.queryOptions({ input: { query: { type: 'knowledge' } } }).queryKey,
    [{ id: 'tag-1', name: 'Support', type: 'knowledge', binding_count: '1' }],
  )
  return render(
    <QueryClientProvider client={queryClient}>
      <button type="button">Before card</button>
      <ul className="mt-4 grid w-80 p-4">
        <KnowledgeSpaceCard
          onDelete={vi.fn()}
          knowledgeSpace={knowledgeSpace}
          onOpenTagManagement={vi.fn()}
        />
      </ul>
    </QueryClientProvider>,
  )
}

const cardRingShadow = (card: Element) => getComputedStyle(card, '::after').boxShadow

const centerOf = (element: Element) => {
  const rect = element.getBoundingClientRect()
  return [rect.left + rect.width / 2, rect.top + rect.height / 2] as const
}

it('draws the card focus inside the clipped card and leaves inner controls their own focus', async () => {
  // Real layout proves the card focus is not clipped by the rounded overflow container and that
  // inner controls stay separate pointer targets above the stretched link.
  const screen = await renderCard()
  const link = screen.getByRole('link', { name: knowledgeSpace.technical_summary!.name })
  const card = link.element().closest('li')!
  const tags = screen.getByRole('combobox', { name: /^Support:/ })
  const more = screen.getByRole('button', { name: 'common.operation.more' })

  screen.getByRole('button', { name: 'Before card' }).element().focus()
  await userEvent.keyboard('{Tab}')
  await expect.element(link).toHaveFocus()
  await expect.poll(() => cardRingShadow(card)).toContain('inset')

  await userEvent.keyboard('{Tab}')
  await expect.element(tags).toHaveFocus()
  await expect.poll(() => cardRingShadow(card)).toBe('none')
  expect(getComputedStyle(tags.element()).boxShadow).not.toBe('none')

  await userEvent.keyboard('{Tab}')
  await expect.element(more).toHaveFocus()
  expect(more.element().checkVisibility({ opacityProperty: true })).toBe(true)
  expect(cardRingShadow(card)).toBe('none')

  for (const control of [tags.element(), more.element()]) {
    const target = document.elementFromPoint(...centerOf(control))
    expect(control.contains(target)).toBe(true)
    expect(target?.closest('a')).toBeNull()
  }
  const footer = screen.getByText('12').element()
  expect(document.elementFromPoint(...centerOf(footer))?.closest('a')).toBe(link.element())
})
