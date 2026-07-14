import type { Role, RoleListResponse } from '@/models/access-control'
import { act, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { vi } from 'vitest'
import { useWorkspaceRoleList } from '@/service/access-control/use-workspace-roles'
import { RoleSelector } from '../role-selector'

vi.mock('@/service/access-control/use-workspace-roles')

const createRole = (overrides: Partial<Role>): Role => ({
  id: overrides.id ?? overrides.name ?? 'role-id',
  tenant_id: 'tenant-id',
  type: 'workspace',
  category: 'global_system_default',
  name: overrides.name ?? 'Role',
  description: overrides.description ?? '',
  is_builtin: overrides.is_builtin ?? true,
  permission_keys: [],
  role_tag: '',
  ...overrides,
})

const roles = [
  createRole({ id: 'admin', name: 'Admin', description: 'Can manage workspace settings' }),
  createRole({ id: 'editor', name: 'Editor', description: 'Can build and edit apps' }),
  createRole({ id: 'normal', name: 'Normal', description: 'Can use apps' }),
]

const createPage = (data: Role[]): RoleListResponse => ({
  data,
  pagination: {
    total_count: data.length,
    per_page: 20,
    current_page: 1,
    total_pages: data.length > 0 ? 1 : 0,
  },
})

const mockUseWorkspaceRoleList = ({
  data = roles,
  isLoading = false,
  error = null,
  hasNextPage = false,
  fetchNextPage = vi.fn(),
}: {
  data?: Role[]
  isLoading?: boolean
  error?: Error | null
  hasNextPage?: boolean
  fetchNextPage?: () => void
} = {}) => {
  vi.mocked(useWorkspaceRoleList).mockReturnValue({
    data: { pages: [createPage(data)], pageParams: [1] },
    isLoading,
    error,
    hasNextPage,
    isFetchingNextPage: false,
    fetchNextPage,
  } as unknown as ReturnType<typeof useWorkspaceRoleList>)
}

const RoleSelectorWrapper = () => <RoleSelector />

const getTrigger = () => screen.getByRole('combobox', { name: /members\.role/i })
const getListbox = () => screen.getByRole('listbox', { name: /members\.role/i })

describe('RoleSelector', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockUseWorkspaceRoleList()
  })

  it('requires an explicit selection and exposes select semantics', () => {
    render(<RoleSelectorWrapper />)

    expect(getTrigger()).toHaveTextContent(/members\.selectRole/i)
    expect(document.querySelector('input[name="role"]')).toBeRequired()
  })

  it('uses the selected Role object as its typed value', async () => {
    const user = userEvent.setup()
    render(<RoleSelectorWrapper />)

    await user.click(getTrigger())
    await user.click(within(getListbox()).getByRole('option', { name: /Admin/i }))

    expect(getTrigger()).toHaveTextContent('Admin')
    expect(document.querySelector('input[name="role"]')).toHaveValue('admin')
  })

  it('shows role descriptions in the option list', async () => {
    const user = userEvent.setup()
    render(<RoleSelectorWrapper />)

    await user.click(getTrigger())

    expect(within(getListbox()).getByText('Can manage workspace settings')).toBeInTheDocument()
  })

  it('falls back to localized descriptions for legacy built-in roles', async () => {
    const user = userEvent.setup()
    mockUseWorkspaceRoleList({
      data: [
        createRole({ id: 'admin', name: 'admin', description: '' }),
        createRole({ id: 'dataset_operator', name: 'dataset_operator', description: '' }),
      ],
    })
    render(<RoleSelectorWrapper />)

    await user.click(getTrigger())

    expect(within(getListbox()).getByText(/common\.members\.adminTip/i)).toBeInTheDocument()
    expect(
      within(getListbox()).getByText(/common\.members\.datasetOperatorTip/i),
    ).toBeInTheDocument()
  })

  it('renders loading and empty states inside the select popup', async () => {
    const user = userEvent.setup()
    mockUseWorkspaceRoleList({ data: [], isLoading: true })
    const { rerender } = render(<RoleSelectorWrapper />)

    await user.click(getTrigger())
    expect(within(getListbox()).getByText(/common\.loading/i)).toBeInTheDocument()

    mockUseWorkspaceRoleList({ data: [] })
    rerender(<RoleSelectorWrapper />)
    expect(within(getListbox()).getByText(/dynamicSelect\.noData/i)).toBeInTheDocument()
  })

  it('shows an error instead of treating a failed role query as empty', async () => {
    const user = userEvent.setup()
    mockUseWorkspaceRoleList({ data: [], error: new Error('Failed to load roles') })
    render(<RoleSelectorWrapper />)

    await user.click(getTrigger())

    expect(within(getListbox()).getByText(/dynamicSelect\.error/i)).toBeInTheDocument()
    expect(within(getListbox()).queryByText(/dynamicSelect\.noData/i)).not.toBeInTheDocument()
    expect(within(getListbox()).queryByRole('button')).not.toBeInTheDocument()
  })

  it('loads another role page when the list sentinel becomes visible', async () => {
    const user = userEvent.setup()
    const fetchNextPage = vi.fn()
    const callbacks: IntersectionObserverCallback[] = []
    const originalIntersectionObserver = globalThis.IntersectionObserver

    globalThis.IntersectionObserver = class {
      readonly root: Element | Document | null = null
      readonly rootMargin = ''
      readonly scrollMargin = ''
      readonly thresholds: ReadonlyArray<number> = []

      constructor(callback: IntersectionObserverCallback) {
        callbacks.push(callback)
      }

      observe() {}
      unobserve() {}
      disconnect() {}
      takeRecords(): IntersectionObserverEntry[] {
        return []
      }
    }

    mockUseWorkspaceRoleList({ hasNextPage: true, fetchNextPage })
    render(<RoleSelectorWrapper />)

    await user.click(getTrigger())
    await waitFor(() => expect(callbacks).toHaveLength(1))

    await act(async () => {
      callbacks[0]!(
        [{ isIntersecting: true } as IntersectionObserverEntry],
        {} as IntersectionObserver,
      )
    })

    expect(fetchNextPage).toHaveBeenCalledTimes(1)
    globalThis.IntersectionObserver = originalIntersectionObserver
  })
})
