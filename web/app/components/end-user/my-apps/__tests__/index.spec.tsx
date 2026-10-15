import type { UrlUpdateEvent } from 'nuqs/adapters/testing'
import type { EndUserApp, RemoveAppRequest } from '../model'
import { act, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { NuqsTestingAdapter } from 'nuqs/adapters/testing'
import { useState } from 'react'
import { describe, expect, it, vi } from 'vite-plus/test'
import { render } from '@/test/console/render'
import MyApps from '..'

const alpha: EndUserApp = {
  id: 'alpha',
  name: 'Alpha Assistant',
  description: 'Draft articles',
  mode: 'chat',
  icon: '🤖',
  iconBackground: '#D5F5F6',
  starred: false,
  connectionStatus: 'ready',
  lastUsedAt: 100,
}
const beta: EndUserApp = {
  ...alpha,
  id: 'beta',
  name: 'Beta Research',
  description: 'Compare reports',
  mode: 'advanced-chat',
  starred: true,
  lastUsedAt: 200,
}
const zebra: EndUserApp = {
  ...alpha,
  id: 'zebra',
  name: 'Zebra Workflow',
  description: 'Research finance',
  mode: 'workflow',
  starred: true,
  lastUsedAt: 300,
}
const apps: readonly EndUserApp[] = [alpha, beta, zebra]
const appHref = 'https://agent-app.dify.dev/workflow/RWv44MH1ypIb8gs8'
const appLabel = (key: string, app: EndUserApp) =>
  `app.endUser.${key}:${JSON.stringify({ name: app.name })}`
const appNames = () => {
  const list = screen.queryByRole('list')
  return list
    ? within(list)
        .getAllByRole('heading', { level: 2 })
        .map((heading) => heading.textContent)
    : []
}

const setup = ({
  initialApps = apps,
  searchParams = '',
  onRemoveApp = vi.fn<(request: RemoveAppRequest) => void | Promise<void>>(),
}: {
  initialApps?: readonly EndUserApp[]
  searchParams?: string
  onRemoveApp?: ReturnType<typeof vi.fn<(request: RemoveAppRequest) => void | Promise<void>>>
} = {}) => {
  const getAppHref = (_app: EndUserApp) => appHref
  const onToggleStar = vi.fn<(id: string) => void>()
  const onUrlUpdate = vi.fn<(event: UrlUpdateEvent) => void>()
  const Harness = () => {
    const [items, setItems] = useState(initialApps)
    return (
      <MyApps
        apps={items}
        getAppHref={getAppHref}
        onToggleStar={(id) => {
          onToggleStar(id)
          setItems((current) =>
            current.map((app) => (app.id === id ? { ...app, starred: !app.starred } : app)),
          )
        }}
        onRemoveApp={async (request) => {
          await onRemoveApp(request)
          setItems((current) => current.filter((app) => app.id !== request.app.id))
        }}
      />
    )
  }
  // Persist URL writes when a parent callback updates the controlled app list.
  const rendered = render(
    <NuqsTestingAdapter hasMemory searchParams={searchParams} onUrlUpdate={onUrlUpdate}>
      <Harness />
    </NuqsTestingAdapter>,
  )
  return { ...rendered, onUrlUpdate, onToggleStar, onRemoveApp }
}

const openRemoval = async (
  user: ReturnType<typeof userEvent.setup>,
  app: EndUserApp,
  deleteChats: boolean,
) => {
  await user.click(screen.getByRole('button', { name: appLabel('appActions', app) }))
  await user.click(
    await screen.findByRole('menuitem', {
      name: deleteChats ? 'app.endUser.removeAndDeleteChats' : 'app.endUser.removeFromList',
    }),
  )
  return screen.findByRole('alertdialog', {
    name: deleteChats ? 'app.endUser.deleteChatsTitle' : appLabel('removeTitle', app),
  })
}

describe('MyApps', () => {
  it.each([
    { sort: 'name', label: 'app.endUser.nameAscending', expectedNames: [beta.name, zebra.name] },
    {
      sort: 'name-desc',
      label: 'app.endUser.nameDescending',
      expectedNames: [zebra.name, beta.name],
    },
  ])(
    'restores view, search and $sort sorting from the URL with native app links',
    ({ sort, label, expectedNames }) => {
      const { onUrlUpdate } = setup({
        searchParams: `?view=starred&sort=${sort}&q=%20RESEARCH%20`,
      })

      expect(screen.getByRole('radio', { name: 'app.endUser.starred' })).toBeChecked()
      expect(screen.getByRole('combobox', { name: 'app.endUser.sortBy' })).toHaveTextContent(label)
      expect(screen.getByRole('searchbox', { name: 'app.endUser.searchApps' })).toHaveValue(
        ' RESEARCH ',
      )
      expect(appNames()).toEqual(expectedNames)
      expect(onUrlUpdate).not.toHaveBeenCalled()

      for (const name of expectedNames) {
        const link = screen.getByRole('link', { name })
        expect(link).toHaveAttribute('href', appHref)
        expect(link).not.toHaveAttribute('target')
      }
    },
  )

  it('clears a search without resetting Starred or sorting, then restores All while preserving unrelated URL state', async () => {
    const user = userEvent.setup()
    const { onUrlUpdate } = setup({ searchParams: '?unrelated=keep' })
    expect(appNames()).toEqual([zebra.name, beta.name, alpha.name])
    await user.click(screen.getByRole('combobox', { name: 'app.endUser.sortBy' }))
    await user.click(await screen.findByRole('option', { name: 'app.endUser.nameAscending' }))
    expect(appNames()).toEqual([alpha.name, beta.name, zebra.name])
    await waitFor(() =>
      expect(onUrlUpdate.mock.lastCall?.[0].searchParams.get('sort')).toBe('name'),
    )

    await user.click(screen.getByRole('radio', { name: 'app.endUser.starred' }))
    expect(appNames()).toEqual([beta.name, zebra.name])
    const search = screen.getByRole('searchbox', { name: 'app.endUser.searchApps' })
    await user.type(search, 'REPORT')
    expect(appNames()).toEqual([beta.name])
    await waitFor(() => expect(onUrlUpdate.mock.lastCall?.[0].searchParams.get('q')).toBe('REPORT'))
    expect(onUrlUpdate.mock.lastCall?.[0].searchParams.get('view')).toBe('starred')

    await user.clear(search)
    await user.type(search, 'not present')
    expect(screen.getByRole('heading', { name: 'app.endUser.noResults' })).toBeVisible()
    expect(screen.getByText('app.endUser.noResultsDescription')).toBeVisible()
    expect(screen.queryByRole('heading', { name: 'app.endUser.emptyApps' })).not.toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'common.operation.clear' }))

    expect(search).toHaveValue('')
    expect(screen.getByRole('radio', { name: 'app.endUser.starred' })).toBeChecked()
    expect(appNames()).toEqual([beta.name, zebra.name])
    await waitFor(() => {
      const params = onUrlUpdate.mock.lastCall?.[0].searchParams
      expect(params?.has('q')).toBe(false)
      expect(params?.get('view')).toBe('starred')
      expect(params?.get('sort')).toBe('name')
      expect(params?.get('unrelated')).toBe('keep')
    })

    await user.click(screen.getByRole('radio', { name: 'app.endUser.all' }))
    expect(screen.getByRole('radio', { name: 'app.endUser.all' })).toBeChecked()
    expect(appNames()).toEqual([alpha.name, beta.name, zebra.name])
    await waitFor(() => {
      const params = onUrlUpdate.mock.lastCall?.[0].searchParams
      expect(params?.has('q')).toBe(false)
      expect(params?.has('view')).toBe(false)
      expect(params?.get('sort')).toBe('name')
      expect(params?.get('unrelated')).toBe('keep')
    })
  })

  it('shows an empty app library before search or Starred empty states when the dataset is empty', () => {
    setup({ initialApps: [], searchParams: '?view=starred&sort=name-desc&q=not+present' })

    expect(screen.getByRole('heading', { name: 'app.endUser.emptyApps' })).toBeVisible()
    expect(screen.getByText('app.endUser.emptyAppsDescription')).toBeVisible()
    expect(screen.queryByRole('heading', { name: 'app.endUser.noResults' })).not.toBeInTheDocument()
    expect(screen.getByRole('searchbox', { name: 'app.endUser.searchApps' })).toHaveValue(
      'not present',
    )
    expect(screen.getByRole('radio', { name: 'app.endUser.starred' })).toBeChecked()
    expect(screen.getByRole('combobox', { name: 'app.endUser.sortBy' })).toHaveTextContent(
      'app.endUser.nameDescending',
    )
  })

  it('selects descending names without clearing the current Starred view or search', async () => {
    const user = userEvent.setup()
    const { onUrlUpdate } = setup({ searchParams: '?view=starred&sort=name&q=RESEARCH' })
    expect(appNames()).toEqual([beta.name, zebra.name])
    const sort = screen.getByRole('combobox', { name: 'app.endUser.sortBy' })
    await user.click(sort)
    await user.click(await screen.findByRole('option', { name: 'app.endUser.nameDescending' }))

    expect(sort).toHaveTextContent('app.endUser.nameDescending')
    expect(appNames()).toEqual([zebra.name, beta.name])
    expect(screen.getByRole('radio', { name: 'app.endUser.starred' })).toBeChecked()
    expect(screen.getByRole('searchbox', { name: 'app.endUser.searchApps' })).toHaveValue(
      'RESEARCH',
    )
    await waitFor(() => {
      const params = onUrlUpdate.mock.lastCall?.[0].searchParams
      expect(params?.get('sort')).toBe('name-desc')
      expect(params?.get('view')).toBe('starred')
      expect(params?.get('q')).toBe('RESEARCH')
    })
  })

  it('adds a starred app to Starred and removes it immediately when unstarred', async () => {
    const user = userEvent.setup()
    const { onToggleStar, onRemoveApp } = setup({ initialApps: [alpha] })
    await user.click(screen.getByRole('button', { name: appLabel('starApp', alpha) }))
    expect(screen.getByRole('button', { name: appLabel('unstarApp', alpha) })).toHaveAttribute(
      'aria-pressed',
      'true',
    )
    await user.click(screen.getByRole('radio', { name: 'app.endUser.starred' }))
    expect(screen.getByRole('radio', { name: 'app.endUser.starred' })).toBeChecked()
    expect(appNames()).toEqual([alpha.name])
    expect(screen.getByRole('link', { name: alpha.name })).toHaveAttribute('href', appHref)

    await user.click(screen.getByRole('button', { name: appLabel('unstarApp', alpha) }))

    expect(onToggleStar).toHaveBeenNthCalledWith(1, alpha.id)
    expect(onToggleStar).toHaveBeenNthCalledWith(2, alpha.id)
    expect(onRemoveApp).not.toHaveBeenCalled()
    expect(screen.getByRole('heading', { name: 'app.endUser.emptyApps' })).toBeVisible()
    expect(screen.getByText('app.endUser.emptyAppsDescription')).toBeVisible()
    expect(screen.queryByRole('link', { name: alpha.name })).not.toBeInTheDocument()
  })

  it.each([false, true])(
    'confirms removal with deleteChats=%s from the corresponding menu action',
    async (deleteChats) => {
      const user = userEvent.setup()
      const { onRemoveApp, onToggleStar } = setup({ initialApps: [alpha] })
      const dialog = await openRemoval(user, alpha, deleteChats)
      if (deleteChats) {
        expect(dialog).toHaveAccessibleDescription(/app\.endUser\.deleteChatsDescription/)
        expect(within(dialog).getByText(appLabel('deleteChatsDescription', alpha))).toBeVisible()
        expect(within(dialog).getByText('app.endUser.deleteChatsDisclaimer')).toBeVisible()
      } else {
        expect(dialog).toHaveAccessibleDescription('app.endUser.removeDescription')
        expect(
          within(dialog).queryByText('app.endUser.deleteChatsDisclaimer'),
        ).not.toBeInTheDocument()
      }
      expect(onRemoveApp).not.toHaveBeenCalled()

      await user.click(
        within(dialog).getByRole('button', {
          name: deleteChats ? 'app.endUser.removeAndDeleteChats' : 'app.endUser.removeFromList',
        }),
      )

      await waitFor(() => expect(dialog).not.toBeInTheDocument())
      expect(onRemoveApp).toHaveBeenCalledExactlyOnceWith({ app: alpha, deleteChats })
      expect(onToggleStar).not.toHaveBeenCalled()
      expect(screen.queryByRole('link', { name: alpha.name })).not.toBeInTheDocument()
      expect(screen.getByRole('heading', { name: 'app.endUser.emptyApps' })).toBeVisible()
      await waitFor(() =>
        expect(screen.getByRole('searchbox', { name: 'app.endUser.searchApps' })).toHaveFocus(),
      )
    },
  )

  it('restores focus to the second app actions when cancelled after a successful removal', async () => {
    const user = userEvent.setup()
    const { onRemoveApp } = setup({ initialApps: [alpha, beta] })
    const firstDialog = await openRemoval(user, alpha, false)
    await user.click(
      within(firstDialog).getByRole('button', { name: 'app.endUser.removeFromList' }),
    )
    await waitFor(() => expect(firstDialog).not.toBeInTheDocument())

    const trigger = screen.getByRole('button', { name: appLabel('appActions', beta) })
    const secondDialog = await openRemoval(user, beta, true)
    await user.click(within(secondDialog).getByRole('button', { name: 'common.operation.cancel' }))

    await waitFor(() => expect(secondDialog).not.toBeInTheDocument())
    expect(onRemoveApp).toHaveBeenCalledExactlyOnceWith({ app: alpha, deleteChats: false })
    expect(appNames()).toEqual([beta.name])
    expect(screen.getByRole('link', { name: beta.name })).toHaveAttribute('href', appHref)
    await waitFor(() => expect(trigger).toHaveFocus())
  })

  it('keeps a failed removal open for retry and prevents duplicate submissions while pending', async () => {
    const user = userEvent.setup()
    let rejectRemoval!: (error: Error) => void
    const pendingRemoval = new Promise<void>((_resolve, reject) => {
      rejectRemoval = reject
    })
    const onRemoveApp = vi
      .fn<(request: RemoveAppRequest) => Promise<void>>()
      .mockReturnValueOnce(pendingRemoval)
      .mockResolvedValueOnce(undefined)
    setup({ initialApps: [alpha], onRemoveApp })
    const dialog = await openRemoval(user, alpha, false)
    const confirm = within(dialog).getByRole('button', { name: 'app.endUser.removeFromList' })
    await user.click(confirm)
    expect(confirm).toHaveAttribute('aria-disabled', 'true')
    expect(within(dialog).getByRole('button', { name: 'common.operation.cancel' })).toBeDisabled()
    await user.click(confirm)
    expect(onRemoveApp).toHaveBeenCalledOnce()

    await act(async () => {
      rejectRemoval(new Error('Removal failed'))
      await pendingRemoval.catch(() => {})
    })
    expect(await within(dialog).findByRole('alert')).toHaveTextContent('app.endUser.removeError')
    expect(confirm).not.toHaveAttribute('aria-disabled', 'true')
    expect(confirm).toHaveFocus()
    await user.click(confirm)

    await waitFor(() => expect(dialog).not.toBeInTheDocument())
    expect(onRemoveApp).toHaveBeenCalledTimes(2)
    expect(onRemoveApp).toHaveBeenLastCalledWith({ app: alpha, deleteChats: false })
    expect(screen.getByRole('heading', { name: 'app.endUser.emptyApps' })).toBeVisible()
    await waitFor(() =>
      expect(screen.getByRole('searchbox', { name: 'app.endUser.searchApps' })).toHaveFocus(),
    )
  })
})
