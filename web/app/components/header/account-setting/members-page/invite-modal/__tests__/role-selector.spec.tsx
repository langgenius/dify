import type { Role, RoleListResponse } from '@/models/access-control'
import { act, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { useState } from 'react'
import { vi } from 'vitest'
import { useWorkspaceRoleList } from '@/service/access-control/use-workspace-roles'
import RoleSelector from '../role-selector'

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

const rolePages: RoleListResponse[] = [
  {
    data: [
      createRole({ id: 'admin', name: 'Admin', description: 'Can manage workspace settings' }),
      createRole({ id: 'editor', name: 'Editor', description: 'Can build and edit apps' }),
      createRole({ id: 'normal', name: 'Normal', description: 'Can use apps' }),
    ],
    pagination: {
      total_count: 3,
      per_page: 20,
      current_page: 1,
      total_pages: 1,
    },
  },
]

const mockUseWorkspaceRoleList = ({
  pages = rolePages,
  isLoading = false,
  hasNextPage = false,
  isFetchingNextPage = false,
  fetchNextPage = vi.fn(),
}: {
  pages?: RoleListResponse[]
  isLoading?: boolean
  hasNextPage?: boolean
  isFetchingNextPage?: boolean
  fetchNextPage?: () => void
} = {}) => {
  vi.mocked(useWorkspaceRoleList).mockReturnValue({
    data: { pages, pageParams: [1] },
    isLoading,
    error: null,
    hasNextPage,
    isFetchingNextPage,
    fetchNextPage,
  } as unknown as ReturnType<typeof useWorkspaceRoleList>)
}

type WrapperProps = {
  initialRole?: string
}

const RoleSelectorWrapper = ({ initialRole = 'normal' }: WrapperProps) => {
  const [role, setRole] = useState(initialRole)
  return <RoleSelector value={role} onChange={setRole} />
}

const getTrigger = () =>
  screen.getByRole('button', { name: /members\.(invitedAsRole|selectRole)/i })
const getRoleMenu = () => screen.getByRole('menu')
const getRoleOption = (role: string) =>
  within(getRoleMenu()).getByRole('menuitemradio', { name: new RegExp(role, 'i') })

describe('RoleSelector', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockUseWorkspaceRoleList()
  })

  it('should show current role name in trigger text', () => {
    render(<RoleSelectorWrapper initialRole="admin" />)

    expect(screen.getByText(/members\.invitedAsRole:\{"role":"Admin"\}/i)).toBeInTheDocument()
  })

  it('should ask users to select a role when no role is selected', () => {
    render(<RoleSelectorWrapper initialRole="" />)

    expect(screen.getByText(/members\.selectRole/i)).toBeInTheDocument()
    expect(screen.queryByText(/members\.invitedAsRole:\{"role":""\}/i)).not.toBeInTheDocument()
  })

  it('should toggle dropdown when trigger is clicked', async () => {
    const user = userEvent.setup()
    render(<RoleSelectorWrapper />)

    await user.click(getTrigger())
    expect(getRoleOption('Normal')).toBeInTheDocument()

    await user.click(getTrigger())
    await waitFor(() => {
      expect(screen.queryByRole('menu')).not.toBeInTheDocument()
    })
  })

  it('should show checkmark state for selected role', async () => {
    const user = userEvent.setup()
    render(<RoleSelectorWrapper initialRole="editor" />)

    await user.click(getTrigger())

    expect(getRoleOption('Editor')).toHaveAttribute('aria-checked', 'true')
  })

  it('should show legacy descriptions for built-in roles without descriptions', async () => {
    const user = userEvent.setup()

    mockUseWorkspaceRoleList({
      pages: [
        {
          data: [
            createRole({ id: 'admin', name: 'admin', description: '' }),
            createRole({ id: 'editor', name: 'editor', description: '' }),
            createRole({ id: 'normal', name: 'normal', description: '' }),
            createRole({ id: 'dataset_operator', name: 'dataset_operator', description: '' }),
          ],
          pagination: {
            total_count: 4,
            per_page: 20,
            current_page: 1,
            total_pages: 1,
          },
        },
      ],
    })

    render(<RoleSelectorWrapper initialRole="" />)

    await user.click(getTrigger())

    const roleMenu = getRoleMenu()

    expect(within(roleMenu).getByText(/common\.members\.adminTip/i)).toBeInTheDocument()
    expect(within(roleMenu).getByText(/common\.members\.editorTip/i)).toBeInTheDocument()
    expect(within(roleMenu).getByText(/common\.members\.normalTip/i)).toBeInTheDocument()
    expect(within(roleMenu).getByText(/common\.members\.datasetOperatorTip/i)).toBeInTheDocument()
    expect(within(roleMenu).queryByText(/permission\.role\.noDescription/i)).not.toBeInTheDocument()
  })

  it('should update selected role name after user chooses a role', async () => {
    const user = userEvent.setup()

    render(<RoleSelectorWrapper initialRole="Normal" />)

    await user.click(getTrigger())
    await user.click(getRoleOption('Admin'))

    await waitFor(() => {
      expect(screen.queryByRole('menu')).not.toBeInTheDocument()
    })

    expect(screen.getByText(/members\.invitedAsRole:\{"role":"Admin"\}/i)).toBeInTheDocument()
  })

  it('should load more roles when scrolling reaches the list anchor', async () => {
    const user = userEvent.setup()
    const fetchNextPage = vi.fn()
    const callbacks: IntersectionObserverCallback[] = []
    const originalIntersectionObserver = globalThis.IntersectionObserver

    globalThis.IntersectionObserver = class {
      readonly root: Element | Document | null = null
      readonly rootMargin: string = ''
      readonly scrollMargin: string = ''
      readonly thresholds: ReadonlyArray<number> = []

      constructor(callback: IntersectionObserverCallback) {
        callbacks.push(callback)
      }

      observe() {
        /* noop */
      }
      unobserve() {
        /* noop */
      }
      disconnect() {
        /* noop */
      }
      takeRecords(): IntersectionObserverEntry[] {
        return []
      }
    }

    mockUseWorkspaceRoleList({ hasNextPage: true, fetchNextPage })

    render(<RoleSelectorWrapper />)

    await user.click(getTrigger())
    await waitFor(() => {
      expect(callbacks).toHaveLength(1)
    })

    await act(async () => {
      callbacks[0]!(
        [{ isIntersecting: true } as IntersectionObserverEntry],
        {} as IntersectionObserver,
      )
    })

    expect(fetchNextPage).toHaveBeenCalledTimes(1)

    globalThis.IntersectionObserver = originalIntersectionObserver
  })

  it('should render an empty state when there are no roles', async () => {
    const user = userEvent.setup()
    mockUseWorkspaceRoleList({
      pages: [
        {
          data: [],
          pagination: {
            total_count: 0,
            per_page: 20,
            current_page: 1,
            total_pages: 0,
          },
        },
      ],
    })

    render(<RoleSelectorWrapper initialRole="" />)

    await user.click(getTrigger())

    expect(within(getRoleMenu()).getByText(/dynamicSelect\.noData/i)).toBeInTheDocument()
  })
})
