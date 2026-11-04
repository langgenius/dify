import type { Role, RoleListResponse } from '@/models/access-control'
import { act, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { vi } from 'vite-plus/test'
import { renderWithConsoleQuery as render } from '@/test/console/query-data'
import { createDeferred } from '@/test/deferred'
import { RoleSelector } from '../role-selector'

const getRoles = vi.hoisted(() => vi.fn())
vi.mock('@/service/console', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/service/console')>()
  const { withConsoleResponses } = await import('@/test/console/service-responses')
  return {
    ...actual,
    consoleQuery: withConsoleResponses(actual.consoleQuery, {
      'workspaces.current.rbac.roles.get': getRoles,
    }),
  }
})

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

const getTrigger = () => screen.getByRole('combobox', { name: /members\.role/i })
const getListbox = () => screen.getByRole('listbox')

describe('RoleSelector', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    getRoles.mockReset().mockResolvedValue(createPage(roles))
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('requires an explicit selection and exposes select semantics', () => {
    render(<RoleSelector />)

    expect(getTrigger().textContent).toMatch(/members\.selectRole/i)
    expect(document.querySelector('input[name="role"]')).toBeRequired()
  })

  it('uses the selected Role object as its typed value', async () => {
    const user = userEvent.setup()
    render(<RoleSelector />)

    await user.click(getTrigger())
    const admin = await within(getListbox()).findByRole('option', { name: /Admin/i })
    expect(admin).toHaveTextContent('Can manage workspace settings')
    await user.click(admin)

    expect(getTrigger()).toHaveTextContent('Admin')
    expect(document.querySelector('input[name="role"]')).toHaveValue('admin')
  })

  it('falls back to localized descriptions for legacy built-in roles', async () => {
    const user = userEvent.setup()
    getRoles.mockResolvedValue(
      createPage([
        createRole({ id: 'admin', name: 'admin', description: '' }),
        createRole({ id: 'dataset_operator', name: 'dataset_operator', description: '' }),
      ]),
    )
    render(<RoleSelector />)

    await user.click(getTrigger())

    expect(
      within(getListbox()).getByText(/workspaceMembers\.members\.adminTip/i),
    ).toBeInTheDocument()
    expect(
      within(getListbox()).getByText(/workspaceMembers\.members\.datasetOperatorTip/i),
    ).toBeInTheDocument()
  })

  it('replaces the loading state with the empty state after the first page arrives', async () => {
    const user = userEvent.setup()
    const request = createDeferred<RoleListResponse>()
    getRoles.mockReturnValue(request.promise)
    render(<RoleSelector />)
    await user.click(getTrigger())
    expect(within(getListbox()).getByText(/common\.loading/i)).toBeInTheDocument()
    await act(async () => request.resolve(createPage([])))
    expect(await within(getListbox()).findByText(/dynamicSelect\.noData/i)).toBeInTheDocument()
  })

  it('shows an error instead of treating a failed first page as empty', async () => {
    const user = userEvent.setup()
    getRoles.mockRejectedValue(new Error('Failed to load roles'))
    render(<RoleSelector />)
    await user.click(getTrigger())
    expect(await within(getListbox()).findByText(/dynamicSelect\.error/i)).toBeInTheDocument()
    expect(within(getListbox()).queryByText(/dynamicSelect\.noData/i)).not.toBeInTheDocument()
  })

  it.each([false, true])(
    'preserves loaded roles after requesting the next page (failure: %s)',
    async (fails) => {
      const user = userEvent.setup()
      const callbacks: IntersectionObserverCallback[] = []
      vi.stubGlobal(
        'IntersectionObserver',
        class {
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
        },
      )

      const nextRole = createRole({ id: 'next-role', name: 'Additional role' })
      getRoles.mockResolvedValueOnce({
        ...createPage(roles),
        pagination: { total_count: 4, per_page: 3, current_page: 1, total_pages: 2 },
      })
      if (fails) getRoles.mockRejectedValueOnce(new Error('Failed to load another role page'))
      else
        getRoles.mockResolvedValueOnce({
          ...createPage([nextRole]),
          pagination: { total_count: 4, per_page: 3, current_page: 2, total_pages: 2 },
        })
      render(<RoleSelector />)

      await user.click(getTrigger())
      await within(getListbox()).findByRole('option', { name: /Admin/i })
      await waitFor(() => expect(callbacks.length).toBeGreaterThan(0))

      await act(async () => {
        callbacks.at(-1)!(
          [{ isIntersecting: true } as IntersectionObserverEntry],
          {} as IntersectionObserver,
        )
      })

      await waitFor(() => expect(getRoles).toHaveBeenCalledTimes(2))
      expect(getRoles).toHaveBeenLastCalledWith({
        query: expect.objectContaining({ page: 2, limit: 20 }),
      })
      if (!fails)
        expect(
          await within(getListbox()).findByRole('option', { name: /Additional role/i }),
        ).toBeInTheDocument()
      expect(within(getListbox()).getByRole('option', { name: /Admin/i })).toBeInTheDocument()
      expect(within(getListbox()).queryByText(/dynamicSelect\.error/i)).not.toBeInTheDocument()
    },
  )
})
