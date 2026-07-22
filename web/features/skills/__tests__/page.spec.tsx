import type {
  SkillResponse,
  SkillTagResponse,
} from '@dify/contracts/api/console/workspaces/types.gen'
import type { ReactNode } from 'react'
import { toast } from '@langgenius/dify-ui/toast'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import SkillsPage from '../page'

const mocks = vi.hoisted(() => ({
  createSkillMutationFn: vi.fn(),
  deleteSkillMutationFn: vi.fn(),
  duplicateSkillMutationFn: vi.fn(),
  importSkillMutationFn: vi.fn(),
  push: vi.fn(),
  queryState: {
    keyword: '',
    tag: [] as string[],
  },
  skills: [] as SkillResponse[],
  skillsKey: vi.fn((_options: unknown): unknown[] => ['skills']),
  skillsQueryOptions: vi.fn((_options: unknown) => ({})),
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

vi.mock('@/service/client', () => ({
  consoleQuery: {
    workspaces: {
      current: {
        skills: {
          get: {
            key: mocks.skillsKey,
            queryOptions: mocks.skillsQueryOptions,
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
    mocks.tags = [
      { count: 2, tag: 'support' },
      { count: 1, tag: 'sales' },
    ]
    mocks.skillsKey.mockImplementation((options) => ['skills', options])
    mocks.tagsKey.mockImplementation((options) => ['skill-tags', options])
    mocks.skillsQueryOptions.mockImplementation((options) => ({
      queryKey: ['skills', options],
      queryFn: async () => ({
        data: mocks.skills,
        has_more: false,
        page: 1,
        total: mocks.skills.length,
      }),
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
      expect(mocks.skillsQueryOptions).toHaveBeenLastCalledWith(
        expect.objectContaining({
          input: {
            query: {
              keyword: 'refund',
            },
          },
        }),
      )
    })

    await user.click(screen.getByRole('button', { name: 'agentV2.skillManagement.tags' }))
    await waitFor(() => {
      expect(screen.getAllByText('support').length).toBeGreaterThan(1)
    })
    await user.click(screen.getAllByText('support').at(-1)!)

    await waitFor(() => {
      expect(mocks.skillsQueryOptions).toHaveBeenLastCalledWith(
        expect.objectContaining({
          input: {
            query: {
              keyword: 'refund',
              tag: ['support'],
            },
          },
        }),
      )
    })
  })

  it('creates a placeholder skill and navigates to its detail page', async () => {
    const user = userEvent.setup()
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
    expect(mocks.push).toHaveBeenCalledWith('/skills/created-skill')
  })

  it('imports a package file and navigates to the imported skill', async () => {
    const user = userEvent.setup()
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
    expect(mocks.push).toHaveBeenCalledWith('/skills/imported-skill')
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
