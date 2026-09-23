import type { TagResponse as Tag } from '@dify/contracts/api/console/tags/types.gen'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { createStore, Provider } from 'jotai'
import { render } from 'vitest-browser-react'
import { DatasetCardTags } from '@/features/tag-management/components/dataset-card-tags'
import { seedRegisteredConsoleStateFixture } from '@/test/console/state-fixture'

const tagList: Tag[] = [
  {
    id: 'knowledge-tag-1',
    name: 'Knowledge',
    type: 'knowledge',
    binding_count: '',
  },
]

vi.mock('@/context/permission-state', async () => {
  const { createPermissionStateModuleMock } = await import('@/test/console/state-fixture')
  return createPermissionStateModuleMock(() => ({
    workspacePermissionKeys: ['dataset.tag.manage'],
  }))
})

vi.mock('@/service/console', () => ({
  consoleQuery: {
    tags: {
      get: {
        queryOptions: () => ({
          queryFn: async () => tagList,
          queryKey: ['tags', 'knowledge'],
        }),
      },
      post: {
        mutationOptions: () => ({
          mutationFn: async () => tagList[0]!,
        }),
      },
    },
  },
}))

vi.mock('@/features/tag-management/hooks/use-tag-mutations', () => ({
  useApplyTagBindingsMutation: () => ({
    mutate: vi.fn(),
  }),
}))

const renderTagSelector = () => {
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: {
        retry: false,
      },
    },
  })
  const store = createStore()
  seedRegisteredConsoleStateFixture(store)

  return render(
    <Provider store={store}>
      <QueryClientProvider client={queryClient}>
        <DatasetCardTags datasetId="dataset-1" embeddingAvailable tags={[]} canBindOrUnbindTags />
      </QueryClientProvider>
    </Provider>,
  )
}

describe('Dataset card tag selector navigation', () => {
  it('does not trigger the parent click handler when selecting an existing tag', async () => {
    const onOuterClick = vi.fn()

    document.addEventListener('click', onOuterClick)
    try {
      const screen = await renderTagSelector()

      await screen.getByRole('combobox', { name: 'common.tag.addTag' }).click()
      await screen.getByRole('option', { name: 'Knowledge' }).click()

      expect(onOuterClick).not.toHaveBeenCalled()
    } finally {
      document.removeEventListener('click', onOuterClick)
    }
  })

  it('does not trigger the parent click handler when creating a tag', async () => {
    const onOuterClick = vi.fn()

    document.addEventListener('click', onOuterClick)
    try {
      const screen = await renderTagSelector()

      await screen.getByRole('combobox', { name: 'common.tag.addTag' }).click()
      const input = screen.getByRole('combobox', { name: 'common.tag.selectorPlaceholder' })
      await input.fill('NewTag')
      await screen.getByRole('option', { name: /NewTag/ }).click()

      expect(onOuterClick).not.toHaveBeenCalled()
    } finally {
      document.removeEventListener('click', onOuterClick)
    }
  })

  it('does not trigger the parent click handler when opening tag management', async () => {
    const onOuterClick = vi.fn()

    document.addEventListener('click', onOuterClick)
    try {
      const screen = await renderTagSelector()

      await screen.getByRole('combobox', { name: 'common.tag.addTag' }).click()
      await screen.getByRole('button', { name: 'common.tag.manageTags' }).click()

      expect(onOuterClick).not.toHaveBeenCalled()
    } finally {
      document.removeEventListener('click', onOuterClick)
    }
  })
})
