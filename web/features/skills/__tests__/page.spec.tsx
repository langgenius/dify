import type {
  SkillResponse,
  SkillTagResponse,
} from '@dify/contracts/api/console/workspaces/types.gen'
import type { ReactNode } from 'react'
import { toast } from '@langgenius/dify-ui/toast'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'
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
  queryState: {
    keyword: '',
    tag: [] as string[],
  },
  skills: [] as SkillResponse[],
  skillPages: [] as SkillResponse[][],
  skillsKey: vi.fn((_options: unknown): unknown[] => ['skills']),
  skillsQueryOptions: vi.fn((_options: SkillsInfiniteOptions) => ({})),
  tags: [] as SkillTagResponse[],
  tagsKey: vi.fn((_options: unknown): unknown[] => ['skill-tags']),
  tagsQueryOptions: vi.fn((_options: unknown) => ({})),
}))

vi.mock('@langgenius/dify-ui/toast', () => ({
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

vi.mock('@/hooks/use-timestamp', () => ({
  default: () => ({
    formatTime: () => '2026-07-22 10:00',
  }),
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

vi.mock('@/service/client', () => ({
  consoleQuery: {
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
    reference_count: 2,
    created_at: 1784631405,
    updated_at: 1784638487,
    ...overrides,
  }
}

function renderSkillsPage() {
  const queryClient = new QueryClient({
    defaultOptions: {
      mutations: { retry: false },
      queries: { retry: false },
    },
  })

  return render(
    <QueryClientProvider client={queryClient}>
      <SkillsPage />
    </QueryClientProvider>,
  )
}

describe('SkillsPage', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.queryState.keyword = ''
    mocks.queryState.tag = []
    mocks.skills = [createSkill()]
    mocks.skillPages = [mocks.skills]
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
    mocks.createSkillMutationFn.mockResolvedValue(createSkill({ id: 'created-skill' }))
    mocks.importSkillMutationFn.mockResolvedValue(createSkill({ id: 'imported-skill' }))
    mocks.duplicateSkillMutationFn.mockResolvedValue(createSkill({ id: 'duplicated-skill' }))
    mocks.exportSkillArchiveBlob.mockResolvedValue(new Blob(['skill archive']))
    mocks.deleteSkillMutationFn.mockResolvedValue({
      deleted: true,
      id: 'skill-1',
    })
  })

  it('renders skills with tags, reference count, and detail links', async () => {
    renderSkillsPage()

    const skillLink = await screen.findByRole('link', { name: /Refund approval/ })
    expect(skillLink).toHaveAttribute('href', '/skills/skill-1')
    expect(screen.getByText('refund-approval')).toBeInTheDocument()
    expect(screen.getByText('Handle refund requests.')).toBeInTheDocument()
    expect(screen.getByText('support')).toBeInTheDocument()
    expect(
      screen.getByText('agentV2.skillManagement.referenceCount:{"count":2}'),
    ).toBeInTheDocument()
  })

  it('passes keyword and selected tags to the list query', async () => {
    const user = userEvent.setup()
    renderSkillsPage()

    await user.type(
      await screen.findByRole('searchbox', {
        name: 'agentV2.skillManagement.searchLabel',
      }),
      'refund',
    )

    await waitFor(() => {
      const queryOptions = mocks.skillsQueryOptions.mock.lastCall?.[0]
      expect(queryOptions?.input(1)).toEqual({
        query: {
          keyword: 'refund',
          limit: 20,
          page: 1,
        },
      })
    })

    await user.click(screen.getByRole('button', { name: 'agentV2.skillManagement.tags' }))
    await waitFor(() => {
      expect(screen.getAllByText('support').length).toBeGreaterThan(1)
    })
    await user.click(screen.getAllByText('support').at(-1)!)

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
    mocks.skills = firstPageSkills
    mocks.skillPages = [firstPageSkills, [nextPageSkill]]

    renderSkillsPage()

    const skillList = await screen.findByRole('region', {
      name: 'agentV2.skillManagement.listLabel',
    })
    await screen.findByRole('heading', { name: 'Skill 1' })
    expect(within(skillList).getAllByRole('article')).toHaveLength(20)

    const scrollViewport = skillList.parentElement?.parentElement
    expect(scrollViewport).not.toBeNull()
    Object.defineProperties(scrollViewport!, {
      clientHeight: { configurable: true, value: 600 },
      scrollHeight: { configurable: true, value: 1200 },
      scrollTop: { configurable: true, value: 560 },
    })
    fireEvent.scroll(scrollViewport!)

    expect(await screen.findByRole('heading', { name: 'Skill 21' })).toBeInTheDocument()
    expect(within(skillList).getAllByRole('article')).toHaveLength(21)
    expect(mocks.skillsQueryOptions.mock.lastCall?.[0].input(2)).toEqual({
      query: {
        limit: 20,
        page: 2,
      },
    })
  })

  it('creates a placeholder skill and navigates to its detail page', async () => {
    const user = userEvent.setup()
    const invalidateQueries = vi.spyOn(QueryClient.prototype, 'invalidateQueries')
    renderSkillsPage()

    await user.click(await screen.findByRole('button', { name: 'agentV2.skillManagement.create' }))

    await waitFor(() => {
      expect(mocks.createSkillMutationFn).toHaveBeenCalledWith(
        {
          body: {},
        },
        expect.anything(),
      )
    })
    expect(toast.success).toHaveBeenCalledWith('agentV2.skillManagement.createSuccess')
    expect(invalidateQueries).toHaveBeenCalledWith({ queryKey: ['skills', { type: 'query' }] })
    expect(invalidateQueries).toHaveBeenCalledWith({ queryKey: ['skills', { type: 'infinite' }] })
    expect(invalidateQueries).toHaveBeenCalledWith({
      queryKey: ['skill-tags', { type: 'query' }],
    })
    expect(mocks.push).toHaveBeenCalledWith('/skills/created-skill')
    invalidateQueries.mockRestore()
  })

  it('imports a package file and navigates to the imported skill', async () => {
    const user = userEvent.setup()
    const invalidateQueries = vi.spyOn(QueryClient.prototype, 'invalidateQueries')
    const { container } = renderSkillsPage()

    const fileInput = container.querySelector<HTMLInputElement>('input[type="file"]')
    expect(fileInput).not.toBeNull()
    const file = new File(['skill'], 'refund.skill', { type: 'application/zip' })

    await user.upload(fileInput!, file)

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
    expect(toast.success).toHaveBeenCalledWith('agentV2.skillManagement.importSuccess')
    expect(invalidateQueries).toHaveBeenCalledWith({ queryKey: ['skills', { type: 'query' }] })
    expect(invalidateQueries).toHaveBeenCalledWith({ queryKey: ['skills', { type: 'infinite' }] })
    expect(invalidateQueries).toHaveBeenCalledWith({
      queryKey: ['skill-tags', { type: 'query' }],
    })
    expect(mocks.push).toHaveBeenCalledWith('/skills/imported-skill')
    invalidateQueries.mockRestore()
  })

  it('duplicates a skill from the card action menu', async () => {
    const user = userEvent.setup()
    renderSkillsPage()

    await user.click(
      await screen.findByRole('button', {
        name: 'agentV2.skillManagement.moreActions:{"name":"Refund approval"}',
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
    expect(toast.success).toHaveBeenCalledWith('agentV2.skillManagement.duplicateSuccess')
  })

  it('exports a published skill from the card action menu', async () => {
    const user = userEvent.setup()
    renderSkillsPage()

    await user.click(
      await screen.findByRole('button', {
        name: 'agentV2.skillManagement.moreActions:{"name":"Refund approval"}',
      }),
    )
    await user.click(await screen.findByText('common.operation.export'))

    await waitFor(() => {
      expect(mocks.exportSkillArchiveBlob).toHaveBeenCalledWith('skill-1')
    })
    expect(mocks.downloadBlob).toHaveBeenCalledWith({
      data: expect.any(Blob),
      fileName: 'refund-approval.zip',
    })
  })

  it('does not show export for an unpublished skill', async () => {
    const user = userEvent.setup()
    mocks.skills = [createSkill({ latest_published_version_id: null })]
    mocks.skillPages = [mocks.skills]
    renderSkillsPage()

    await user.click(
      await screen.findByRole('button', {
        name: 'agentV2.skillManagement.moreActions:{"name":"Refund approval"}',
      }),
    )

    expect(screen.queryByText('common.operation.export')).not.toBeInTheDocument()
  })

  it('confirms deletion with the skill name and refreshes list data', async () => {
    const user = userEvent.setup()
    renderSkillsPage()

    await user.click(
      await screen.findByRole('button', {
        name: 'agentV2.skillManagement.moreActions:{"name":"Refund approval"}',
      }),
    )
    await user.click(await screen.findByText('common.operation.delete'))
    const dialog = await screen.findByRole('alertdialog')

    expect(
      within(dialog).getByText(
        'agentV2.skillManagement.deleteDialog.referencedDescription:{"count":2}',
      ),
    ).toBeInTheDocument()

    await user.click(within(dialog).getByRole('button', { name: 'common.operation.delete' }))

    await waitFor(() => {
      expect(mocks.deleteSkillMutationFn).toHaveBeenCalledWith(
        {
          body: {
            confirmation_name: 'refund-approval',
          },
          params: {
            skill_id: 'skill-1',
          },
        },
        expect.anything(),
      )
    })
    expect(toast.success).toHaveBeenCalledWith('agentV2.skillManagement.deleteSuccess')
  })

  it('shows the empty-search state without create or import actions', async () => {
    mocks.queryState.keyword = 'missing'
    mocks.skills = []
    mocks.skillPages = [[]]

    renderSkillsPage()

    expect(await screen.findByText('agentV2.skillManagement.emptySearch')).toBeInTheDocument()
    expect(
      screen.queryByText('agentV2.skillManagement.emptyAction.createTitle'),
    ).not.toBeInTheDocument()
    expect(
      screen.queryByText('agentV2.skillManagement.emptyAction.importTitle'),
    ).not.toBeInTheDocument()
  })
})
