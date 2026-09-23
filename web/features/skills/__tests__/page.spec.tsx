import type { TagResponse as Tag } from '@dify/contracts/api/console/tags/types.gen'
import type {
  SkillReferenceResponse,
  SkillResponse,
  SkillTagResponse,
} from '@dify/contracts/api/console/workspaces/types.gen'
import type { ComponentProps, ReactNode } from 'react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { createEvent, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vite-plus/test'
import { toast } from '@/app/notifications'
import SkillsPage from '../page'

type SkillsInfiniteOptions = {
  getNextPageParam: (lastPage: { has_more: boolean; page: number }) => number | undefined
  initialPageParam: number
  input: (pageParam: unknown) => {
    query: Record<string, unknown>
  }
}

const mocks = vi.hoisted(() => ({
  createSkillMutationFn: vi.fn(),
  deleteSkillMutationFn: vi.fn(),
  downloadBlob: vi.fn(),
  duplicateSkillMutationFn: vi.fn(),
  exportSkillArchiveBlob: vi.fn(),
  importSkillMutationFn: vi.fn(),
  push: vi.fn(),
  genericTags: [] as Tag[],
  genericTagsQueryOptions: vi.fn((_options: unknown) => ({})),
  queryState: {
    keyword: '',
    tag: [] as string[],
  },
  skills: [] as SkillResponse[],
  skillPages: [] as SkillResponse[][],
  skillsKey: vi.fn((_options: unknown): unknown[] => ['skills']),
  skillsQueryOptions: vi.fn((_options: SkillsInfiniteOptions) => ({})),
  skillReferences: [] as SkillReferenceResponse[],
  skillReferencesQueryOptions: vi.fn((_options: unknown) => ({})),
  tags: [] as SkillTagResponse[],
  tagsKey: vi.fn((_options: unknown): unknown[] => ['skill-tags']),
  tagsQueryOptions: vi.fn((_options: unknown) => ({})),
}))

vi.mock('react-i18next', async () => {
  const actual = await vi.importActual<typeof import('react-i18next')>('react-i18next')
  const { createInstance } = await vi.importActual<typeof import('i18next')>('i18next')
  const { createReactI18nextMock } = await import('@/test/i18n-mock')
  const { default: skillTranslations } = await import('@/i18n/locales/en-US/skill.json')
  const i18n = createInstance()
  await i18n.init({
    lng: 'en-US',
    fallbackLng: false,
    keySeparator: false,
    resources: { 'en-US': { skill: skillTranslations } },
  })

  return {
    ...actual,
    ...createReactI18nextMock(),
    // Keep components embedded in translations, including the real Browse button.
    Trans: (props: ComponentProps<typeof actual.Trans>) => <actual.Trans {...props} i18n={i18n} />,
  }
})

vi.mock('@/app/notifications', () => ({
  toast: {
    error: vi.fn(),
    success: vi.fn(),
  },
}))

vi.mock('ahooks', () => ({
  useDebounce: (value: unknown) => value,
}))

vi.mock('nuqs', async () => {
  const React = await import('react')
  const listeners = new Map<'keyword' | 'tag', Set<() => void>>()
  const createParser = () => ({
    withDefault: () => ({
      withOptions: () => ({}),
    }),
  })

  return {
    debounce: () => undefined,
    parseAsArrayOf: () => ({
      withDefault: () => ({}),
    }),
    parseAsString: createParser(),
    useQueryState: (name: 'keyword' | 'tag') => {
      const [value, setValue] = React.useState(mocks.queryState[name])
      React.useEffect(() => {
        const nameListeners = listeners.get(name) ?? new Set<() => void>()
        listeners.set(name, nameListeners)
        const listener = () => setValue(mocks.queryState[name])
        nameListeners.add(listener)

        return () => {
          nameListeners.delete(listener)
        }
      }, [name])
      const setQueryValue = (nextValue: string | string[]) => {
        mocks.queryState[name] = nextValue as never
        setValue(nextValue as never)
        listeners.get(name)?.forEach((listener) => listener())
        return Promise.resolve(new URLSearchParams())
      }

      return [value, setQueryValue] as const
    },
  }
})

vi.mock('@/hooks/use-document-title', () => ({
  default: vi.fn(),
}))

vi.mock('@/hooks/use-format-time-from-now', () => ({
  useFormatTimeFromNow: () => ({
    formatTimeFromNow: () => '2 hours ago',
  }),
}))

vi.mock('@/hooks/use-timestamp', () => ({
  default: () => ({
    formatTime: () => '2026-07-22 10:00',
  }),
}))

vi.mock('@/app/components/base/app-icon', () => ({
  default: ({ icon }: { icon?: string }) => <span>{icon}</span>,
}))

vi.mock('@/features/tag-management/components/skill-card-tags', () => ({
  SkillCardTags: ({ tags }: { tags: string[] }) => (
    <button type="button" aria-label={tags.join(', ')}>
      {tags.join(', ')}
    </button>
  ),
}))

vi.mock('../skill-list-tag-management-modal', () => ({
  SkillListTagManagementModal: () => null,
}))

vi.mock('@/next/link', () => ({
  default: ({ children, href, ...props }: { children: ReactNode; href: string }) => (
    <a href={href} {...props}>
      {children}
    </a>
  ),
}))

vi.mock('@/next/navigation', () => ({
  useRouter: () => ({
    push: mocks.push,
  }),
}))

vi.mock('@/utils/download', () => ({
  downloadBlob: mocks.downloadBlob,
}))

vi.mock('../client', () => ({
  fetchSkillArchiveBlob: mocks.exportSkillArchiveBlob,
  uploadSkillFile: vi.fn(),
}))

vi.mock('@/service/console', () => ({
  consoleQuery: {
    tags: {
      get: {
        queryOptions: mocks.genericTagsQueryOptions,
      },
    },
    workspaces: {
      current: {
        skills: {
          get: {
            key: mocks.skillsKey,
            infiniteOptions: mocks.skillsQueryOptions,
          },
          post: {
            mutationOptions: () => ({ mutationFn: mocks.createSkillMutationFn }),
          },
          import: {
            post: {
              mutationOptions: () => ({ mutationFn: mocks.importSkillMutationFn }),
            },
          },
          tags: {
            get: {
              key: mocks.tagsKey,
              queryOptions: mocks.tagsQueryOptions,
            },
          },
          bySkillId: {
            delete: {
              mutationOptions: () => ({ mutationFn: mocks.deleteSkillMutationFn }),
            },
            references: {
              get: {
                queryOptions: mocks.skillReferencesQueryOptions,
              },
            },
            duplicate: {
              post: {
                mutationOptions: () => ({ mutationFn: mocks.duplicateSkillMutationFn }),
              },
            },
          },
        },
      },
    },
  },
}))

vi.mock('../permissions', () => ({
  useSkillPermissions: () => ({ canDelete: true, canEdit: true, canPublish: true }),
}))

function createSkill(overrides: Partial<SkillResponse> = {}): SkillResponse {
  return {
    id: 'skill-1',
    name: 'refund-approval',
    display_name: 'Refund approval',
    icon: '💳',
    description: 'Handle refund requests.',
    tags: ['support'],
    visibility: 'workspace',
    latest_published_version_id: 'version-1',
    latest_published_at: 1784638400,
    reference_count: 2,
    created_at: 1784631405,
    updated_at: 1784638487,
    ...overrides,
  }
}

function createAgentReference(
  overrides: Partial<SkillReferenceResponse> = {},
): SkillReferenceResponse {
  return {
    agent_id: 'agent-1',
    agent_icon: '🤖',
    agent_icon_background: '#EFF6FF',
    agent_icon_type: 'emoji',
    app_id: 'app-1',
    display_name: 'Support Agent',
    name: 'support-agent',
    type: 'agent',
    ...overrides,
  }
}

function createTestQueryClient() {
  return new QueryClient({
    defaultOptions: { mutations: { retry: false }, queries: { retry: false } },
  })
}

function renderSkillsPage(queryClient = createTestQueryClient()) {
  return render(
    <QueryClientProvider client={queryClient}>
      <SkillsPage />
    </QueryClientProvider>,
  )
}

async function openImportDialog(user: ReturnType<typeof userEvent.setup>) {
  await user.click(await screen.findByRole('button', { name: 'skill.skillManagement.import' }))

  return screen.findByRole('dialog', {
    name: 'skill.skillManagement.importDialog.title',
  })
}

describe('SkillsPage', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.queryState.keyword = ''
    mocks.queryState.tag = []
    mocks.skills = [createSkill()]
    mocks.skillPages = [mocks.skills]
    mocks.skillReferences = [createAgentReference()]
    mocks.genericTags = [
      { binding_count: '2', id: 'tag-support', name: 'support', type: 'skill' },
      { binding_count: '1', id: 'tag-sales', name: 'sales', type: 'skill' },
    ]
    mocks.tags = [
      { count: 2, tag: 'support' },
      { count: 1, tag: 'sales' },
    ]
    mocks.skillsKey.mockImplementation((options) => ['skills', options])
    mocks.tagsKey.mockImplementation((options) => ['skill-tags', options])
    mocks.skillsQueryOptions.mockImplementation((options) => ({
      queryKey: ['skills', options],
      queryFn: async ({ pageParam }: { pageParam: unknown }) => {
        const page = Number(pageParam)
        return {
          data: mocks.skillPages[page - 1] ?? [],
          has_more: page < mocks.skillPages.length,
          page,
          total: mocks.skillPages.flat().length,
        }
      },
      getNextPageParam: options.getNextPageParam,
      initialPageParam: options.initialPageParam,
    }))
    mocks.tagsQueryOptions.mockImplementation((options) => ({
      queryKey: ['skill-tags', options],
      queryFn: async () => ({
        data: mocks.tags,
      }),
    }))
    mocks.genericTagsQueryOptions.mockImplementation((options) => ({
      queryKey: ['tags', options],
      queryFn: async () => mocks.genericTags,
    }))
    mocks.skillReferencesQueryOptions.mockImplementation((options) => ({
      queryKey: ['skill-references', options],
      queryFn: async () => ({
        data: mocks.skillReferences,
      }),
    }))
    mocks.createSkillMutationFn.mockResolvedValue(createSkill({ id: 'created-skill' }))
    mocks.importSkillMutationFn.mockResolvedValue(createSkill({ id: 'imported-skill' }))
    mocks.duplicateSkillMutationFn.mockResolvedValue(createSkill({ id: 'duplicated-skill' }))
    mocks.exportSkillArchiveBlob.mockResolvedValue(new Blob(['skill archive']))
    mocks.deleteSkillMutationFn.mockResolvedValue({
      deleted: true,
      id: 'skill-1',
    })
  })

  it('exposes loading as a status without presenting skeletons as skill items', () => {
    mocks.skillsQueryOptions.mockImplementation((options) => ({
      queryKey: ['skills-pending', options],
      queryFn: () => new Promise(() => {}),
      getNextPageParam: options.getNextPageParam,
      initialPageParam: options.initialPageParam,
    }))

    renderSkillsPage()

    const skillRegion = screen.getByRole('region', {
      name: 'skill.skillManagement.listLabel',
    })
    expect(skillRegion).toHaveAttribute('aria-busy', 'true')
    expect(within(skillRegion).getByRole('status')).toHaveTextContent('common.loading')
    expect(within(skillRegion).queryByRole('list')).not.toBeInTheDocument()
    expect(within(skillRegion).queryByRole('listitem')).not.toBeInTheDocument()
  })

  it('exposes a failed skill request as an alert without a stale list', async () => {
    mocks.skillsQueryOptions.mockImplementation((options) => ({
      queryKey: ['skills-error', options],
      queryFn: () => Promise.reject(new Error('skills request failed')),
      getNextPageParam: options.getNextPageParam,
      initialPageParam: options.initialPageParam,
    }))

    renderSkillsPage()

    const skillRegion = screen.getByRole('region', {
      name: 'skill.skillManagement.listLabel',
    })
    expect(await within(skillRegion).findByRole('alert')).toHaveTextContent(
      'skill.skillManagement.loadingError',
    )
    expect(
      within(skillRegion).getByRole('button', { name: 'common.operation.retry' }),
    ).toBeInTheDocument()
    expect(within(skillRegion).queryByRole('list')).not.toBeInTheDocument()
  })

  it('replaces a cached empty state with a retryable error when refetch fails', async () => {
    const user = userEvent.setup()
    const queryKey = ['skills-cached-empty-refetch-error']
    let requestCount = 0
    mocks.skillsQueryOptions.mockImplementation((options) => ({
      queryKey,
      queryFn: () => {
        requestCount += 1
        return Promise.reject(new Error('skills refetch failed'))
      },
      getNextPageParam: options.getNextPageParam,
      initialPageParam: options.initialPageParam,
    }))
    const queryClient = createTestQueryClient()
    queryClient.setQueryData(queryKey, {
      pages: [{ data: [], has_more: false, page: 1, total: 0 }],
      pageParams: [1],
    })

    renderSkillsPage(queryClient)

    const skillRegion = screen.getByRole('region', {
      name: 'skill.skillManagement.listLabel',
    })
    const error = await within(skillRegion).findByRole('alert')
    expect(error).toHaveTextContent('skill.skillManagement.loadingError')
    expect(within(skillRegion).queryByText('skill.skillManagement.empty')).not.toBeInTheDocument()
    expect(
      within(skillRegion).queryByRole('button', {
        name: 'skill.skillManagement.emptyAction.createTitle',
      }),
    ).not.toBeInTheDocument()
    expect(within(skillRegion).queryByRole('list')).not.toBeInTheDocument()

    await user.click(within(error).getByRole('button', { name: 'common.operation.retry' }))
    await waitFor(() => {
      expect(requestCount).toBe(2)
    })
  })

  it('renders skills with tags, reference count, and detail links', async () => {
    renderSkillsPage()

    const skillLink = await screen.findByRole('link', { name: /Refund approval/ })
    const skillList = screen.getByRole('list')
    expect(screen.getByRole('listitem', { name: 'Refund approval' })).toBeInTheDocument()
    expect(skillList).toContainElement(skillLink)
    expect(skillLink).toHaveAttribute('href', '/skills/skill-1')
    expect(skillLink).toHaveAccessibleDescription('Handle refund requests.')
    expect(within(skillLink).queryByRole('button')).not.toBeInTheDocument()
    expect(screen.getByText('refund-approval')).toBeInTheDocument()
    expect(screen.getByText('Handle refund requests.')).toBeInTheDocument()
    expect(screen.getByText('support')).toBeInTheDocument()
    expect(
      screen.getByText('skill.skillManagement.referenceCount_other:{"count":2}'),
    ).toBeInTheDocument()
    expect(
      screen.getByText('skill.skillManagement.publishedAt:{"time":"2 hours ago"}'),
    ).toBeInTheDocument()
  })

  it('tabs from the card More action to its tag trigger', async () => {
    const user = userEvent.setup()
    renderSkillsPage()

    const skillLink = await screen.findByRole('link', { name: /Refund approval/ })
    const moreButton = screen.getByRole('button', {
      name: 'skill.skillManagement.moreActions:{"name":"Refund approval"}',
    })
    const tagTrigger = screen.getByRole('button', { name: 'support' })

    skillLink.focus()
    await user.tab()
    expect(moreButton).toHaveFocus()
    await user.tab()
    expect(tagTrigger).toHaveFocus()
  })

  it('renders draft update time as relative time', async () => {
    mocks.skills = [createSkill({ latest_published_version_id: null, latest_published_at: null })]
    mocks.skillPages = [mocks.skills]

    renderSkillsPage()

    const skillLink = await screen.findByRole('link', { name: 'Refund approval' })
    expect(skillLink).toHaveAccessibleDescription(
      'skill.skillManagement.draft Handle refund requests.',
    )
    expect(
      screen.getByText('skill.skillManagement.editedAt:{"time":"2 hours ago"}'),
    ).toBeInTheDocument()
  })

  it('shows guidance instead of a persisted editor placeholder when description is empty', async () => {
    mocks.skills = [createSkill({ description: '' })]
    mocks.skillPages = [mocks.skills]

    renderSkillsPage()

    expect(await screen.findByText('skill.skillManagement.noDescription')).toBeInTheDocument()
  })

  it('passes keyword and selected tags to the list query', async () => {
    mocks.queryState.keyword = 'refund'
    mocks.queryState.tag = ['support']
    renderSkillsPage()

    await waitFor(() => {
      const queryOptions = mocks.skillsQueryOptions.mock.lastCall?.[0]
      expect(queryOptions?.input(1)).toEqual({
        query: {
          keyword: 'refund',
          limit: 20,
          page: 1,
          tag: ['support'],
        },
      })
    })
  })

  it('uses the localized Skills search hint as the search placeholder', async () => {
    renderSkillsPage()

    expect(
      await screen.findByRole('searchbox', {
        name: 'skill.skillManagement.searchLabel',
      }),
    ).toHaveAttribute('placeholder', 'skill.skillManagement.searchPlaceholder')
  })

  it('clears stale tag names from the URL-backed filter state', async () => {
    mocks.queryState.tag = ['renamed-tag']

    renderSkillsPage()

    await waitFor(() => {
      expect(mocks.queryState.tag).toEqual([])
    })
    await waitFor(() => {
      const queryOptions = mocks.skillsQueryOptions.mock.lastCall?.[0]
      expect(queryOptions?.input(1)).toEqual({
        query: {
          limit: 20,
          page: 1,
        },
      })
    })
  })

  it('loads the next skill page when the list scrolls near the bottom', async () => {
    const firstPageSkills = Array.from({ length: 20 }, (_, index) =>
      createSkill({
        id: `skill-${index + 1}`,
        name: `skill-${index + 1}`,
        display_name: `Skill ${index + 1}`,
      }),
    )
    const nextPageSkill = createSkill({
      id: 'skill-21',
      name: 'skill-21',
      display_name: 'Skill 21',
    })
    let resolveNextPage:
      | ((page: { data: SkillResponse[]; has_more: boolean; page: number; total: number }) => void)
      | undefined
    mocks.skillsQueryOptions.mockImplementation((options) => ({
      queryKey: ['skills-deferred-next-page', options],
      queryFn: async ({ pageParam }: { pageParam: unknown }) => {
        if (Number(pageParam) === 1) {
          return {
            data: firstPageSkills,
            has_more: true,
            page: 1,
            total: 21,
          }
        }

        return new Promise((resolve) => {
          resolveNextPage = resolve
        })
      },
      getNextPageParam: options.getNextPageParam,
      initialPageParam: options.initialPageParam,
    }))

    renderSkillsPage()

    const skillList = await screen.findByRole('region', {
      name: 'skill.skillManagement.listLabel',
    })
    await screen.findByRole('heading', { name: 'Skill 1' })
    expect(within(skillList).getAllByRole('listitem')).toHaveLength(20)

    const scrollViewport = skillList.parentElement?.parentElement
    expect(scrollViewport).not.toBeNull()
    Object.defineProperties(scrollViewport!, {
      clientHeight: { configurable: true, value: 600 },
      scrollHeight: { configurable: true, value: 1200 },
      scrollTop: { configurable: true, value: 560 },
    })
    fireEvent.scroll(scrollViewport!)

    const paginationLoading = await within(skillList).findByRole('status')
    expect(paginationLoading).toHaveTextContent('common.loading')
    expect(paginationLoading).toBeVisible()
    expect(within(skillList).getAllByRole('listitem')).toHaveLength(20)

    resolveNextPage?.({
      data: [nextPageSkill],
      has_more: false,
      page: 2,
      total: 21,
    })
    expect(await screen.findByRole('heading', { name: 'Skill 21' })).toBeInTheDocument()
    expect(within(skillList).getAllByRole('listitem')).toHaveLength(21)
    expect(mocks.skillsQueryOptions.mock.lastCall?.[0].input(2)).toEqual({
      query: {
        limit: 20,
        page: 2,
      },
    })
  })

  it('waits for a cached first page to refetch before auto-loading the next page', async () => {
    const queryKey = ['skills-cached-refetch']
    const staleFirstPage = Array.from({ length: 20 }, (_, index) =>
      createSkill({
        id: `stale-skill-${index + 1}`,
        name: `stale-skill-${index + 1}`,
        display_name: `Stale Skill ${index + 1}`,
      }),
    )
    const freshFirstPage = staleFirstPage.map((skill, index) =>
      createSkill({
        ...skill,
        display_name: `Fresh Skill ${index + 1}`,
      }),
    )
    let resolveFirstPageRefetch:
      | ((page: { data: SkillResponse[]; has_more: boolean; page: number; total: number }) => void)
      | undefined
    let nextPageRequestCount = 0
    mocks.skillsQueryOptions.mockImplementation((options) => ({
      queryKey,
      queryFn: ({ pageParam }: { pageParam: unknown }) => {
        if (Number(pageParam) === 1) {
          return new Promise((resolve) => {
            resolveFirstPageRefetch = resolve
          })
        }

        nextPageRequestCount += 1
        return Promise.resolve({
          data: [createSkill({ id: 'skill-21', name: 'skill-21', display_name: 'Fresh Skill 21' })],
          has_more: false,
          page: 2,
          total: 21,
        })
      },
      getNextPageParam: options.getNextPageParam,
      initialPageParam: options.initialPageParam,
    }))
    const queryClient = createTestQueryClient()
    queryClient.setQueryData(queryKey, {
      pages: [
        {
          data: staleFirstPage,
          has_more: true,
          page: 1,
          total: 21,
        },
      ],
      pageParams: [1],
    })

    renderSkillsPage(queryClient)

    const skillRegion = screen.getByRole('region', {
      name: 'skill.skillManagement.listLabel',
    })
    expect(await screen.findByRole('heading', { name: 'Stale Skill 1' })).toBeInTheDocument()
    const scrollViewport = skillRegion.parentElement?.parentElement
    expect(scrollViewport).not.toBeNull()
    Object.defineProperties(scrollViewport!, {
      clientHeight: { configurable: true, value: 600 },
      scrollHeight: { configurable: true, value: 1200 },
      scrollTop: { configurable: true, value: 560 },
    })
    fireEvent.scroll(scrollViewport!)

    expect(nextPageRequestCount).toBe(0)
    expect(screen.getByRole('heading', { name: 'Stale Skill 1' })).toBeInTheDocument()

    resolveFirstPageRefetch?.({
      data: freshFirstPage,
      has_more: true,
      page: 1,
      total: 21,
    })
    expect(await screen.findByRole('heading', { name: 'Fresh Skill 1' })).toBeInTheDocument()
    expect(await screen.findByRole('heading', { name: 'Fresh Skill 21' })).toBeInTheDocument()
    expect(nextPageRequestCount).toBe(1)
  })

  it('keeps loaded skills visible when the next page fails and exposes retry', async () => {
    const user = userEvent.setup()
    const firstPageSkills = Array.from({ length: 20 }, (_, index) =>
      createSkill({
        id: `skill-${index + 1}`,
        name: `skill-${index + 1}`,
        display_name: `Skill ${index + 1}`,
      }),
    )
    let nextPageRequestCount = 0
    let resolveRetry:
      | ((page: { data: SkillResponse[]; has_more: boolean; page: number; total: number }) => void)
      | undefined
    mocks.skillsQueryOptions.mockImplementation((options) => ({
      queryKey: ['skills-next-page-error', options],
      queryFn: async ({ pageParam }: { pageParam: unknown }) => {
        if (Number(pageParam) === 1) {
          return {
            data: firstPageSkills,
            has_more: true,
            page: 1,
            total: 21,
          }
        }

        nextPageRequestCount += 1
        if (nextPageRequestCount === 1) throw new Error('next skill page failed')

        return new Promise((resolve) => {
          resolveRetry = resolve
        })
      },
      getNextPageParam: options.getNextPageParam,
      initialPageParam: options.initialPageParam,
    }))

    renderSkillsPage()

    const skillRegion = await screen.findByRole('region', {
      name: 'skill.skillManagement.listLabel',
    })
    await screen.findByRole('heading', { name: 'Skill 1' })
    const scrollViewport = skillRegion.parentElement?.parentElement
    expect(scrollViewport).not.toBeNull()
    Object.defineProperties(scrollViewport!, {
      clientHeight: { configurable: true, value: 600 },
      scrollHeight: { configurable: true, value: 600 },
      scrollTop: { configurable: true, value: 0 },
    })
    fireEvent.scroll(scrollViewport!)

    const paginationError = await within(skillRegion).findByRole('alert')
    expect(within(skillRegion).getAllByRole('listitem')).toHaveLength(20)
    expect(paginationError).toHaveTextContent('skill.skillManagement.loadingError')
    expect(nextPageRequestCount).toBe(1)

    const retryButton = within(paginationError).getByRole('button', {
      name: 'common.operation.retry',
    })
    await user.click(retryButton)
    await waitFor(() => {
      expect(nextPageRequestCount).toBe(2)
    })
    expect(retryButton).toHaveAttribute('aria-disabled', 'true')
    expect(retryButton).toHaveFocus()
    expect(within(skillRegion).queryByRole('status')).not.toBeInTheDocument()
    expect(within(skillRegion).getAllByRole('listitem')).toHaveLength(20)

    resolveRetry?.({
      data: [createSkill({ id: 'skill-21', name: 'skill-21', display_name: 'Recovered Skill 21' })],
      has_more: false,
      page: 2,
      total: 21,
    })
    expect(await screen.findByRole('heading', { name: 'Recovered Skill 21' })).toBeInTheDocument()
    expect(within(skillRegion).getAllByRole('listitem')).toHaveLength(21)
  })

  it('creates a placeholder skill and navigates to its detail page', async () => {
    const user = userEvent.setup()
    const invalidateQueries = vi.spyOn(QueryClient.prototype, 'invalidateQueries')
    renderSkillsPage()

    await user.click(await screen.findByRole('button', { name: 'skill.skillManagement.create' }))

    await waitFor(() => {
      expect(mocks.createSkillMutationFn).toHaveBeenCalledWith(
        {
          body: {},
        },
        expect.anything(),
      )
    })
    expect(toast.success).toHaveBeenCalledWith('skill.skillManagement.createSuccess')
    expect(invalidateQueries).toHaveBeenCalledWith({ queryKey: ['skills', { type: 'query' }] })
    expect(invalidateQueries).toHaveBeenCalledWith({ queryKey: ['skills', { type: 'infinite' }] })
    expect(invalidateQueries).toHaveBeenCalledWith({
      queryKey: ['skill-tags', { type: 'query' }],
    })
    expect(mocks.push).toHaveBeenCalledWith('/skills/created-skill')
    invalidateQueries.mockRestore()
  })

  it('explains when the workspace skill limit blocks draft creation', async () => {
    const user = userEvent.setup()
    mocks.createSkillMutationFn.mockRejectedValueOnce({ code: 'skill_limit_exceeded' })
    renderSkillsPage()

    await user.click(await screen.findByRole('button', { name: 'skill.skillManagement.create' }))

    await waitFor(() => {
      expect(toast.error).toHaveBeenCalledWith('skill.skillManagement.errors.workspaceLimit')
    })
  })

  it.each(['toolbar', 'empty state'])(
    'shows package requirements from the %s import entry',
    async (entry) => {
      const user = userEvent.setup()
      if (entry === 'empty state') mocks.skillPages = [[]]
      renderSkillsPage()

      await user.click(
        await screen.findByRole('button', {
          name:
            entry === 'toolbar'
              ? 'skill.skillManagement.import'
              : /skill\.skillManagement\.emptyAction\.importTitle/,
        }),
      )

      const dialog = await screen.findByRole('dialog', {
        name: 'skill.skillManagement.importDialog.title',
      })
      expect(dialog).toHaveAccessibleDescription('skill.skillManagement.importDialog.description')
      expect(
        within(dialog).getByRole('button', { name: 'skill.skillManagement.import' }),
      ).toBeDisabled()
      expect(mocks.importSkillMutationFn).not.toHaveBeenCalled()
    },
  )

  it.each(['refund.skill', 'refund.zip'])(
    'stages %s until confirmation, then navigates to the imported skill',
    async (fileName) => {
      const user = userEvent.setup()
      const invalidateQueries = vi.spyOn(QueryClient.prototype, 'invalidateQueries')
      renderSkillsPage()

      const dialog = await openImportDialog(user)
      const file = new File(['skill'], fileName, { type: 'application/zip' })

      await user.upload(
        within(dialog).getByLabelText('skill.skillManagement.importDialog.browse'),
        file,
      )
      expect(within(dialog).getByText(fileName)).toBeInTheDocument()
      expect(mocks.importSkillMutationFn).not.toHaveBeenCalled()
      await user.click(within(dialog).getByRole('button', { name: 'skill.skillManagement.import' }))

      await waitFor(() => {
        expect(mocks.importSkillMutationFn).toHaveBeenCalledWith(
          {
            body: {
              file,
            },
          },
          expect.anything(),
        )
      })
      expect(toast.success).toHaveBeenCalledWith('skill.skillManagement.importSuccess')
      expect(invalidateQueries).toHaveBeenCalledWith({ queryKey: ['skills', { type: 'query' }] })
      expect(invalidateQueries).toHaveBeenCalledWith({ queryKey: ['skills', { type: 'infinite' }] })
      expect(invalidateQueries).toHaveBeenCalledWith({
        queryKey: ['skill-tags', { type: 'query' }],
      })
      expect(mocks.push).toHaveBeenCalledWith('/skills/imported-skill')
      invalidateQueries.mockRestore()
    },
  )

  it('opens the file picker from Browse and waits for confirmation before importing', async () => {
    const user = userEvent.setup()
    renderSkillsPage()
    const dialog = await openImportDialog(user)
    const fileInput = within(dialog).getByLabelText('skill.skillManagement.importDialog.browse')
    const openFilePicker = vi.spyOn(fileInput, 'click')

    try {
      await user.click(within(dialog).getByRole('button', { name: 'Browse' }))
      expect(openFilePicker).toHaveBeenCalledOnce()
    } finally {
      openFilePicker.mockRestore()
    }

    const file = new File(['skill'], 'refund.zip', { type: 'application/zip' })
    await user.upload(fileInput, file)
    expect(within(dialog).getByText(file.name)).toBeInTheDocument()
    expect(mocks.importSkillMutationFn).not.toHaveBeenCalled()

    await user.click(within(dialog).getByRole('button', { name: 'skill.skillManagement.import' }))
    await waitFor(() =>
      expect(mocks.importSkillMutationFn).toHaveBeenCalledWith(
        { body: { file } },
        expect.anything(),
      ),
    )
  })

  it('accepts a file drag after leaving and re-entering the drop zone, then waits for confirmation', async () => {
    const user = userEvent.setup()
    renderSkillsPage()
    const dialog = await openImportDialog(user)
    const dropZone = within(dialog).getByRole('group', {
      name: 'skill.skillManagement.importDialog.title',
    })
    const description = within(dropZone).getByText('skill.skillManagement.importDialog.description')
    const file = new File(['skill'], 'refund.zip', { type: 'application/zip' })
    const dataTransfer = { files: [file], types: ['Files'] }

    expect(fireEvent.dragEnter(dropZone, { dataTransfer })).toBe(false)
    expect(fireEvent.dragEnter(description, { dataTransfer })).toBe(false)
    fireEvent.dragLeave(description, { dataTransfer })
    fireEvent.dragLeave(dropZone, { dataTransfer })
    expect(within(dialog).queryByText(file.name)).not.toBeInTheDocument()

    expect(fireEvent.dragEnter(dropZone, { dataTransfer })).toBe(false)
    const dragOver = createEvent.dragOver(dropZone, { dataTransfer })
    expect(fireEvent(dropZone, dragOver)).toBe(false)
    expect(dragOver).toHaveProperty('dataTransfer.dropEffect', 'copy')
    expect(fireEvent.drop(dropZone, { dataTransfer })).toBe(false)
    expect(within(dialog).getByText(file.name)).toBeInTheDocument()
    expect(mocks.importSkillMutationFn).not.toHaveBeenCalled()

    await user.click(within(dialog).getByRole('button', { name: 'skill.skillManagement.import' }))
    await waitFor(() =>
      expect(mocks.importSkillMutationFn).toHaveBeenCalledWith(
        { body: { file } },
        expect.anything(),
      ),
    )
  })

  it.each(['text/plain', 'text/uri-list'])(
    'does not intercept %s drags or clear the selected package',
    async (type) => {
      const user = userEvent.setup()
      renderSkillsPage()
      const dialog = await openImportDialog(user)
      const file = new File(['skill'], 'refund.skill', { type: 'application/zip' })
      await user.upload(
        within(dialog).getByLabelText('skill.skillManagement.importDialog.browse'),
        file,
      )
      const dropZone = within(dialog).getByRole('group', {
        name: 'skill.skillManagement.importDialog.title',
      })
      const dataTransfer = { files: [], types: [type] }

      expect(fireEvent.dragEnter(dropZone, { dataTransfer })).toBe(true)
      expect(fireEvent.dragOver(dropZone, { dataTransfer })).toBe(true)
      fireEvent.dragLeave(dropZone, { dataTransfer })
      expect(fireEvent.drop(dropZone, { dataTransfer })).toBe(true)
      expect(within(dialog).queryByRole('alert')).not.toBeInTheDocument()
      expect(within(dialog).getByText(file.name)).toBeInTheDocument()
      expect(mocks.importSkillMutationFn).not.toHaveBeenCalled()

      await user.click(within(dialog).getByRole('button', { name: 'skill.skillManagement.import' }))
      await waitFor(() =>
        expect(mocks.importSkillMutationFn).toHaveBeenCalledWith(
          { body: { file } },
          expect.anything(),
        ),
      )
    },
  )

  it.each(['common.operation.cancel', 'common.operation.close'])(
    'clears the staged package when dismissed with %s and reopened',
    async (closeAction) => {
      const user = userEvent.setup()
      renderSkillsPage()
      const dialog = await openImportDialog(user)
      await user.upload(
        within(dialog).getByLabelText('skill.skillManagement.importDialog.browse'),
        new File(['skill'], 'refund.skill', { type: 'application/zip' }),
      )

      await user.click(within(dialog).getByRole('button', { name: closeAction }))
      await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
      const reopenedDialog = await openImportDialog(user)

      expect(within(reopenedDialog).queryByText('refund.skill')).not.toBeInTheDocument()
      expect(
        within(reopenedDialog).getByRole('button', { name: 'skill.skillManagement.import' }),
      ).toBeDisabled()
      expect(mocks.importSkillMutationFn).not.toHaveBeenCalled()
    },
  )

  it('removes a staged package and allows selecting that same file again', async () => {
    const user = userEvent.setup()
    renderSkillsPage()
    const dialog = await openImportDialog(user)
    const file = new File(['skill'], 'refund.skill', { type: 'application/zip' })
    const fileInput = within(dialog).getByLabelText('skill.skillManagement.importDialog.browse')
    await user.upload(fileInput, file)

    await user.click(within(dialog).getByRole('button', { name: 'common.operation.remove' }))
    expect(within(dialog).queryByText('refund.skill')).not.toBeInTheDocument()
    expect(
      within(dialog).getByRole('button', { name: 'skill.skillManagement.import' }),
    ).toBeDisabled()
    await user.upload(fileInput, file)

    expect(within(dialog).getByText('refund.skill')).toBeInTheDocument()
    expect(
      within(dialog).getByRole('button', { name: 'skill.skillManagement.import' }),
    ).toBeEnabled()
    expect(mocks.importSkillMutationFn).not.toHaveBeenCalled()
  })

  it.each([
    ['an unsupported extension', ['refund.txt']],
    ['multiple packages', ['refund.skill', 'support.zip']],
  ])('rejects dropping %s and allows correction before importing', async (_label, fileNames) => {
    const user = userEvent.setup()
    renderSkillsPage()
    const dialog = await openImportDialog(user)
    const dropZone = within(dialog).getByRole('group', {
      name: 'skill.skillManagement.importDialog.title',
    })

    fireEvent.drop(dropZone, {
      dataTransfer: {
        files: fileNames.map((fileName) => new File(['skill'], fileName)),
        types: ['Files'],
      },
    })
    expect(within(dialog).getByRole('alert')).toHaveTextContent(
      'skill.skillManagement.importDialog.invalidFile',
    )
    expect(
      within(dialog).getByRole('button', { name: 'skill.skillManagement.import' }),
    ).toBeDisabled()
    expect(mocks.importSkillMutationFn).not.toHaveBeenCalled()

    const file = new File(['skill'], 'refund.zip', { type: 'application/zip' })
    fireEvent.drop(dropZone, { dataTransfer: { files: [file], types: ['Files'] } })
    expect(within(dialog).queryByRole('alert')).not.toBeInTheDocument()
    expect(within(dialog).getByText('refund.zip')).toBeInTheDocument()
    expect(mocks.importSkillMutationFn).not.toHaveBeenCalled()
    await user.click(within(dialog).getByRole('button', { name: 'skill.skillManagement.import' }))

    await waitFor(() =>
      expect(mocks.importSkillMutationFn).toHaveBeenCalledWith(
        { body: { file } },
        expect.anything(),
      ),
    )
  })

  it('keeps the package stable and prevents repeat submission or dismissal while importing', async () => {
    const user = userEvent.setup()
    let completeImport: ((skill: SkillResponse) => void) | undefined
    mocks.importSkillMutationFn.mockImplementationOnce(
      () =>
        new Promise<SkillResponse>((resolve) => {
          completeImport = resolve
        }),
    )
    renderSkillsPage()
    const dialog = await openImportDialog(user)
    const fileInput = within(dialog).getByLabelText('skill.skillManagement.importDialog.browse')
    const file = new File(['skill'], 'refund.skill', { type: 'application/zip' })
    await user.upload(fileInput, file)
    const importButton = within(dialog).getByRole('button', {
      name: 'skill.skillManagement.import',
    })
    await user.click(importButton)

    await waitFor(() => expect(importButton).toHaveAttribute('aria-disabled', 'true'))
    expect(fileInput).toBeDisabled()
    const cancelButton = within(dialog).getByRole('button', { name: 'common.operation.cancel' })
    const closeButton = within(dialog).getByRole('button', { name: 'common.operation.close' })
    expect(cancelButton).toBeDisabled()
    expect(closeButton).toBeDisabled()
    expect(within(dialog).getByRole('button', { name: 'common.operation.remove' })).toBeDisabled()
    await user.click(importButton)
    await user.click(cancelButton)
    await user.click(closeButton)
    await user.keyboard('{Escape}')
    const dropZone = within(dialog).getByRole('group', {
      name: 'skill.skillManagement.importDialog.title',
    })
    const dataTransfer = {
      files: [new File(['other'], 'replacement.zip')],
      types: ['Files'],
    }
    expect(fireEvent.dragEnter(dropZone, { dataTransfer })).toBe(false)
    const dragOver = createEvent.dragOver(dropZone, { dataTransfer })
    expect(fireEvent(dropZone, dragOver)).toBe(false)
    expect(dragOver).toHaveProperty('dataTransfer.dropEffect', 'none')
    fireEvent.dragLeave(dropZone, { dataTransfer })
    fireEvent.drop(dropZone, { dataTransfer })

    expect(dialog).toBeInTheDocument()
    expect(within(dialog).getByText('refund.skill')).toBeInTheDocument()
    expect(within(dialog).queryByText('replacement.zip')).not.toBeInTheDocument()
    expect(mocks.importSkillMutationFn).toHaveBeenCalledTimes(1)
    completeImport?.(createSkill({ id: 'imported-skill' }))
    await waitFor(() => expect(mocks.push).toHaveBeenCalledWith('/skills/imported-skill'))
  })

  it.each([
    {
      error: {
        data: {
          body: {
            code: 'skill_name_conflict',
            details: { name: 'refund-approval' },
          },
        },
      },
      message: 'skill.skillManagement.errors.nameConflict:{"name":"refund-approval"}',
    },
    {
      error: { code: 'skill_limit_exceeded' },
      message: 'skill.skillManagement.errors.workspaceLimit',
    },
    {
      error: { code: 'missing_skill_md' },
      message: 'skill.skillManagement.errors.missingSkillMd',
    },
    {
      error: { message: 'Skill package must contain SKILL.md' },
      message: 'skill.skillManagement.errors.missingSkillMd',
    },
    {
      error: { message: 'Skill name "refund-approval" already exists' },
      message: 'skill.skillManagement.errors.nameConflict:{"name":"refund-approval"}',
    },
  ])('explains import errors for $error.code', async ({ error, message }) => {
    const user = userEvent.setup()
    mocks.importSkillMutationFn.mockRejectedValueOnce(error)
    renderSkillsPage()
    const dialog = await openImportDialog(user)
    const file = new File(['skill'], 'refund.skill', { type: 'application/zip' })

    await user.upload(
      within(dialog).getByLabelText('skill.skillManagement.importDialog.browse'),
      file,
    )
    await user.click(within(dialog).getByRole('button', { name: 'skill.skillManagement.import' }))

    await waitFor(() => {
      expect(toast.error).toHaveBeenCalledWith(message)
    })
  })

  it('keeps the package available for retry after explaining an error returned as a Response body', async () => {
    const user = userEvent.setup()
    mocks.importSkillMutationFn.mockRejectedValueOnce(
      new Response(JSON.stringify({ message: 'Skill package must contain SKILL.md' }), {
        status: 400,
      }),
    )
    renderSkillsPage()
    const dialog = await openImportDialog(user)
    const file = new File(['skill'], 'refund.skill', { type: 'application/zip' })

    await user.upload(
      within(dialog).getByLabelText('skill.skillManagement.importDialog.browse'),
      file,
    )
    await user.click(within(dialog).getByRole('button', { name: 'skill.skillManagement.import' }))

    await waitFor(() => {
      expect(toast.error).toHaveBeenCalledWith('skill.skillManagement.errors.missingSkillMd')
    })
    expect(within(dialog).getByText('refund.skill')).toBeInTheDocument()
    expect(mocks.push).not.toHaveBeenCalled()
    await user.click(within(dialog).getByRole('button', { name: 'skill.skillManagement.import' }))

    await waitFor(() => expect(mocks.push).toHaveBeenCalledWith('/skills/imported-skill'))
    expect(mocks.importSkillMutationFn).toHaveBeenCalledTimes(2)
    expect(mocks.importSkillMutationFn).toHaveBeenLastCalledWith(
      { body: { file } },
      expect.anything(),
    )
  })

  it('opens the returned duplicate for inline rename from the card action menu', async () => {
    const user = userEvent.setup()
    renderSkillsPage()

    await user.click(
      await screen.findByRole('button', {
        name: 'skill.skillManagement.moreActions:{"name":"Refund approval"}',
      }),
    )
    await user.click(await screen.findByText('common.operation.duplicate'))

    await waitFor(() => {
      expect(mocks.duplicateSkillMutationFn).toHaveBeenCalledWith(
        {
          params: {
            skill_id: 'skill-1',
          },
        },
        expect.anything(),
      )
    })
    expect(toast.success).toHaveBeenCalledWith('skill.skillManagement.duplicateSuccess')
    expect(mocks.push).toHaveBeenCalledWith('/skills/duplicated-skill?rename=true')
  })

  it('stays on the skill list when duplication fails', async () => {
    const user = userEvent.setup()
    mocks.duplicateSkillMutationFn.mockRejectedValue(new Error('Duplicate failed'))
    renderSkillsPage()

    await user.click(
      await screen.findByRole('button', {
        name: 'skill.skillManagement.moreActions:{"name":"Refund approval"}',
      }),
    )
    await user.click(await screen.findByText('common.operation.duplicate'))

    await waitFor(() => {
      expect(toast.error).toHaveBeenCalledWith('skill.skillManagement.duplicateFailed')
    })
    expect(mocks.push).not.toHaveBeenCalled()
  })

  it('exports a published skill from the card action menu', async () => {
    const user = userEvent.setup()
    renderSkillsPage()

    await user.click(
      await screen.findByRole('button', {
        name: 'skill.skillManagement.moreActions:{"name":"Refund approval"}',
      }),
    )
    await user.click(await screen.findByText('common.operation.export'))
    expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument()

    await waitFor(() => {
      expect(mocks.exportSkillArchiveBlob).toHaveBeenCalledWith('skill-1')
    })
    expect(mocks.downloadBlob).toHaveBeenCalledWith({
      data: expect.any(Blob),
      fileName: 'refund-approval.zip',
    })
  })

  it('exports an unpublished skill from the card action menu', async () => {
    const user = userEvent.setup()
    mocks.skills = [createSkill({ latest_published_version_id: null })]
    mocks.skillPages = [mocks.skills]
    renderSkillsPage()

    await user.click(
      await screen.findByRole('button', {
        name: 'skill.skillManagement.moreActions:{"name":"Refund approval"}',
      }),
    )

    await user.click(await screen.findByText('common.operation.export'))
    expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument()
    await waitFor(() => {
      expect(mocks.exportSkillArchiveBlob).toHaveBeenCalledWith('skill-1')
    })
  })

  it('confirms deletion with the skill name and refreshes list data', async () => {
    const user = userEvent.setup()
    renderSkillsPage()

    await user.click(
      await screen.findByRole('button', {
        name: 'skill.skillManagement.moreActions:{"name":"Refund approval"}',
      }),
    )
    await user.click(await screen.findByText('common.operation.delete'))
    const dialog = await screen.findByRole('alertdialog')

    expect(
      within(dialog).getByText(
        'skill.skillManagement.deleteDialog.referencedDescription_other:{"count":2}',
      ),
    ).toBeInTheDocument()
    expect(await within(dialog).findByText('Support Agent')).toBeInTheDocument()
    expect(within(dialog).getByRole('link', { name: /Support Agent/ })).toHaveAttribute(
      'target',
      '_blank',
    )
    expect(within(dialog).getByTestId('skill-delete-reference-list')).toBeInTheDocument()

    await user.type(
      within(dialog).getByPlaceholderText(
        'skill.skillManagement.deleteDialog.confirmInputPlaceholder',
      ),
      'Refund approval',
    )
    await user.click(within(dialog).getByRole('button', { name: 'common.operation.delete' }))

    await waitFor(() => {
      expect(mocks.deleteSkillMutationFn).toHaveBeenCalledWith(
        {
          body: {
            confirmation_name: 'Refund approval',
          },
          params: {
            skill_id: 'skill-1',
          },
        },
        expect.anything(),
      )
    })
    expect(toast.success).toHaveBeenCalledWith('skill.skillManagement.deleteSuccess')
  })

  it('loads references in the delete confirmation when the list reference count is stale', async () => {
    const user = userEvent.setup()
    mocks.skills = [createSkill({ reference_count: 0 })]
    mocks.skillPages = [mocks.skills]
    mocks.skillReferences = [
      createAgentReference({
        agent_id: 'agent-stale-reference',
        display_name: 'Support Agent From References API',
        name: 'support-agent-from-references-api',
      }),
    ]
    renderSkillsPage()

    await user.click(
      await screen.findByRole('button', {
        name: 'skill.skillManagement.moreActions:{"name":"Refund approval"}',
      }),
    )
    await user.click(await screen.findByText('common.operation.delete'))
    const dialog = await screen.findByRole('alertdialog')

    expect(await within(dialog).findByText('Support Agent From References API')).toBeInTheDocument()
    expect(
      within(dialog).getByText(
        'skill.skillManagement.deleteDialog.referencedDescription_one:{"count":1}',
      ),
    ).toBeInTheDocument()
    expect(mocks.skillReferencesQueryOptions).toHaveBeenCalledWith(
      expect.objectContaining({
        input: {
          params: {
            skill_id: 'skill-1',
          },
        },
      }),
    )
  })

  it('keeps deletion disabled while cached references refresh', async () => {
    const user = userEvent.setup()
    let referenceRequestCount = 0
    let shouldHangReferenceRequest = false
    mocks.skills = [createSkill({ reference_count: 0 })]
    mocks.skillPages = [mocks.skills]
    mocks.skillReferencesQueryOptions.mockImplementation((options) => ({
      queryKey: ['skill-references-pending', options],
      queryFn: () => {
        referenceRequestCount += 1
        if (!shouldHangReferenceRequest) return Promise.resolve({ data: [] })

        return new Promise(() => {})
      },
    }))
    renderSkillsPage()

    const moreButton = await screen.findByRole('button', {
      name: 'skill.skillManagement.moreActions:{"name":"Refund approval"}',
    })
    await user.click(moreButton)
    await user.click(await screen.findByText('common.operation.delete'))
    let dialog = await screen.findByRole('alertdialog')

    await waitFor(() => {
      expect(within(dialog).getByRole('button', { name: 'common.operation.delete' })).toBeEnabled()
    })
    const initialRequestCount = referenceRequestCount
    shouldHangReferenceRequest = true
    await user.click(within(dialog).getByRole('button', { name: 'common.operation.cancel' }))
    await waitFor(() => {
      expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument()
    })

    await user.click(moreButton)
    await user.click(await screen.findByText('common.operation.delete'))
    dialog = await screen.findByRole('alertdialog')

    expect(
      within(dialog).getByRole('button', {
        name: 'common.operation.delete',
      }),
    ).toBeDisabled()
    await waitFor(() => {
      expect(referenceRequestCount).toBeGreaterThan(initialRequestCount)
    })
  })

  it('collapses long reference lists in the delete confirmation', async () => {
    const user = userEvent.setup()
    mocks.skillReferences = Array.from({ length: 7 }, (_, index) =>
      createAgentReference({
        agent_id: `agent-${index}`,
        display_name: `Support Agent ${index + 1}`,
        name: `support-agent-${index + 1}`,
      }),
    )
    renderSkillsPage()

    await user.click(
      await screen.findByRole('button', {
        name: 'skill.skillManagement.moreActions:{"name":"Refund approval"}',
      }),
    )
    await user.click(await screen.findByText('common.operation.delete'))
    const dialog = await screen.findByRole('alertdialog')

    expect(await within(dialog).findByText('Support Agent 5')).toBeInTheDocument()
    expect(within(dialog).queryByText('Support Agent 6')).not.toBeInTheDocument()
    expect(within(dialog).getByTestId('skill-delete-reference-list')).not.toHaveAttribute(
      'data-scrollable',
      'true',
    )

    await user.click(
      within(dialog).getByRole('button', {
        name: 'skill.skillManagement.detail.showMoreReferences:{"count":2}',
      }),
    )

    expect(within(dialog).getByText('Support Agent 6')).toBeInTheDocument()
    expect(within(dialog).getByText('Support Agent 7')).toBeInTheDocument()
    expect(within(dialog).getByTestId('skill-delete-reference-list')).toHaveAttribute(
      'data-scrollable',
      'true',
    )
    expect(within(dialog).getByTestId('skill-delete-reference-list')).toHaveClass(
      'max-h-[240px]',
      'overflow-y-auto',
    )
  })

  it('shows the empty-search state without create or import actions', async () => {
    mocks.queryState.keyword = 'missing'
    mocks.skills = []
    mocks.skillPages = [[]]

    renderSkillsPage()

    const skillRegion = screen.getByRole('region', {
      name: 'skill.skillManagement.listLabel',
    })
    const emptySearchTitle = await within(skillRegion).findByText(
      'skill.skillManagement.emptySearch',
    )
    expect(emptySearchTitle.closest('[role="status"]')).toBeInTheDocument()
    expect(
      screen.queryByText('skill.skillManagement.emptyAction.createTitle'),
    ).not.toBeInTheDocument()
    expect(
      screen.queryByText('skill.skillManagement.emptyAction.importTitle'),
    ).not.toBeInTheDocument()
  })
})
