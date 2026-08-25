import type { TagResponse as Tag } from '@dify/contracts/api/console/tags/types.gen'
import type {
  SkillReferenceResponse,
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

vi.mock('@/service/client', () => ({
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

  it('renders skills with tags, reference count, and detail links', async () => {
    renderSkillsPage()

    const skillLink = await screen.findByRole('link', { name: /Refund approval/ })
    expect(screen.getByRole('article', { name: 'Refund approval' })).toBeInTheDocument()
    expect(skillLink).toHaveAttribute('href', '/skills/skill-1')
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

    expect(
      await screen.findByText('skill.skillManagement.editedAt:{"time":"2 hours ago"}'),
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
    mocks.skills = firstPageSkills
    mocks.skillPages = [firstPageSkills, [nextPageSkill]]

    renderSkillsPage()

    const skillList = await screen.findByRole('region', {
      name: 'skill.skillManagement.listLabel',
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
    expect(toast.success).toHaveBeenCalledWith('skill.skillManagement.importSuccess')
    expect(invalidateQueries).toHaveBeenCalledWith({ queryKey: ['skills', { type: 'query' }] })
    expect(invalidateQueries).toHaveBeenCalledWith({ queryKey: ['skills', { type: 'infinite' }] })
    expect(invalidateQueries).toHaveBeenCalledWith({
      queryKey: ['skill-tags', { type: 'query' }],
    })
    expect(mocks.push).toHaveBeenCalledWith('/skills/imported-skill')
    invalidateQueries.mockRestore()
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
    const { container } = renderSkillsPage()
    const fileInput = container.querySelector<HTMLInputElement>('input[type="file"]')
    const file = new File(['skill'], 'refund.skill', { type: 'application/zip' })

    await user.upload(fileInput!, file)

    await waitFor(() => {
      expect(toast.error).toHaveBeenCalledWith(message)
    })
  })

  it('explains an import error returned as a Response body', async () => {
    const user = userEvent.setup()
    mocks.importSkillMutationFn.mockRejectedValueOnce(
      new Response(JSON.stringify({ message: 'Skill package must contain SKILL.md' }), {
        status: 400,
      }),
    )
    const { container } = renderSkillsPage()
    const fileInput = container.querySelector<HTMLInputElement>('input[type="file"]')

    await user.upload(fileInput!, new File(['skill'], 'refund.skill', { type: 'application/zip' }))

    await waitFor(() => {
      expect(toast.error).toHaveBeenCalledWith('skill.skillManagement.errors.missingSkillMd')
    })
  })

  it('duplicates a skill from the card action menu', async () => {
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
        name: 'skill.skillManagement.moreActions:{"name":"Refund approval"}',
      }),
    )

    expect(screen.queryByText('common.operation.export')).not.toBeInTheDocument()
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

    expect(await screen.findByText('skill.skillManagement.emptySearch')).toBeInTheDocument()
    expect(
      screen.queryByText('skill.skillManagement.emptyAction.createTitle'),
    ).not.toBeInTheDocument()
    expect(
      screen.queryByText('skill.skillManagement.emptyAction.importTitle'),
    ).not.toBeInTheDocument()
  })
})
