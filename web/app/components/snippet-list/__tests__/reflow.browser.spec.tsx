import type { consoleClient } from '@/service/console'
import { page } from 'vite-plus/test/browser'
import { render } from 'vitest-browser-react'
import { createConsoleQueryWrapper } from '@/test/console/query-data'
import { installFakeApi } from '@/test/fake-api'
import { createTestNavigation } from '@/test/next-navigation'
import { createNuqsTestWrapper } from '@/test/nuqs-testing'
import SnippetList from '..'

type ListSnippets = typeof consoleClient.workspaces.current.customizedSnippets.get

const snippet: Awaited<ReturnType<ListSnippets>>['data'][number] = {
  created_at: 1704067200,
  created_by: 'creator-1',
  author_name: 'Alice',
  icon_info: null,
  description: 'Builds a sales follow-up.',
  id: 'snippet-1',
  is_published: true,
  name: 'Sales Snippet',
  tags: [],
  type: 'node',
  updated_at: 1704153600,
  updated_by: 'creator-1',
  use_count: 12,
  version: 1,
}

const expectWithinHorizontalBounds = (element: Element, container: Element) => {
  const elementRect = element.getBoundingClientRect()
  const containerRect = container.getBoundingClientRect()

  expect(elementRect.left).toBeGreaterThanOrEqual(containerRect.left - 0.5)
  expect(elementRect.right).toBeLessThanOrEqual(containerRect.right + 0.5)
}

const renderSnippetList = async () => {
  onTestFinished(
    installFakeApi({
      console: {
        workspaces: {
          current: {
            customizedSnippets: {
              get: (input) => ({
                data: input?.query?.keyword ? [] : [snippet],
                has_more: false,
                limit: 30,
                page: 1,
                total: input?.query?.keyword ? 0 : 1,
              }),
            },
            members: {
              get: () => ({
                accounts: [
                  {
                    avatar_url: null,
                    email: 'alice@example.com',
                    id: 'creator-1',
                    name: 'Alice',
                    role: 'owner',
                    status: 'active',
                  },
                ],
              }),
            },
          },
        },
        tags: { get: () => [] },
      },
    }),
  )
  const { wrapper: ConsoleProvider } = createConsoleQueryWrapper({
    accountProfile: { id: 'creator-1' },
    workspacePermissionKeys: ['snippets.create_and_modify'],
  })
  const { wrapper: UrlState } = createNuqsTestWrapper({ hasMemory: true })

  return render(
    <ConsoleProvider>
      <UrlState>
        <main
          aria-label="Snippet list page"
          className="flex h-dvh w-full min-w-0 flex-col overflow-hidden"
          style={{ width: 320 }}
        >
          <SnippetList />
        </main>
      </UrlState>
    </ConsoleProvider>,
    { wrapper: createTestNavigation({ url: '/snippets' }).NavigationProvider },
  )
}

describe('Snippet list reflow', () => {
  afterEach(async () => {
    await page.viewport(1280, 720)
  })

  it('keeps the real filters, search, create action, and card overflow-free with 320 CSS pixels available', async () => {
    // This isolates SnippetList's 320px component contract; the route shell owns page-level width.
    await page.viewport(400, 800)
    const screen = await renderSnippetList()
    const main = screen.getByRole('main', { name: 'Snippet list page' })
    const creatorFilter = screen.getByRole('combobox', {
      name: 'app.studio.filters.creators',
    })
    const statusFilter = screen.getByRole('button', {
      name: /workflow\.common\.published \/ snippet\.draft/i,
    })
    const tagFilter = screen.getByRole('combobox', { name: 'common.tag.placeholder' })
    const search = screen.getByRole('searchbox', { name: 'workflow.tabs.searchSnippets' })
    const createAction = screen.getByRole('button', { name: 'snippet.create' })
    const card = screen.getByRole('article')

    await expect
      .element(screen.getByRole('heading', { name: 'workflow.tabs.snippets' }))
      .toBeVisible()
    await expect.element(creatorFilter).toBeVisible()
    await expect.element(statusFilter).toBeVisible()
    await expect.element(tagFilter).toBeVisible()
    await expect.element(search).toBeVisible()
    await expect.element(createAction).toBeVisible()
    await expect.element(card).toBeVisible()
    await expect.poll(() => document.title).toContain('workflow.tabs.snippets')
    const mainElement = main.element()
    expect(mainElement.scrollWidth).toBe(mainElement.clientWidth)
    ;[creatorFilter, statusFilter, tagFilter, search, createAction, card].forEach((locator) => {
      expectWithinHorizontalBounds(locator.element(), mainElement)
    })

    await search.fill('no matching snippet')
    await expect
      .element(screen.getByRole('status'))
      .toHaveTextContent('workflow.tabs.noSnippetsFound')
    await expect.element(card).not.toBeInTheDocument()
    await search.clear()
    await expect.element(card).toBeVisible()
  })
})
