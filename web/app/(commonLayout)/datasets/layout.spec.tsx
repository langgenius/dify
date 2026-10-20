import { screen, waitFor } from '@testing-library/react'
import { renderWithConsoleQuery as render } from '@/test/console/query-data'
import DatasetsLayout from './layout'

const navigation = vi.hoisted(() => ({ replace: vi.fn(), pathname: '/datasets' }))
vi.mock('@/next/navigation', () => ({
  useRouter: () => ({ replace: navigation.replace }),
  usePathname: () => navigation.pathname,
}))

vi.mock('@/service/console', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/service/console')>()
  const { withConsoleResponses } = await import('@/test/console/service-responses')
  return {
    ...actual,
    consoleQuery: withConsoleResponses(actual.consoleQuery, {
      'workspaces.current.summary.get': () => new Promise(() => {}),
      'workspaces.current.rbac.myPermissions.get': () => new Promise(() => {}),
    }),
  }
})

beforeEach(() => {
  navigation.replace.mockClear()
  navigation.pathname = '/datasets'
})

it.each([{ currentWorkspace: null }, { workspacePermissionKeys: null }])(
  'waits for access data before redirecting a creation route: %o',
  (options) => {
    navigation.pathname = '/datasets/create'
    render(<DatasetsLayout>Datasets content</DatasetsLayout>, options)
    expect(screen.getByRole('progressbar', { name: 'common.loading' })).toBeInTheDocument()
    expect(screen.queryByText('Datasets content')).not.toBeInTheDocument()
    expect(navigation.replace).not.toHaveBeenCalled()
  },
)

it('allows the dataset list without create or connect permissions', () => {
  render(<DatasetsLayout>Datasets content</DatasetsLayout>, { workspacePermissionKeys: [] })
  expect(screen.getByText('Datasets content')).toBeInTheDocument()
  expect(navigation.replace).not.toHaveBeenCalled()
})

it.each([
  ['/datasets/create', 'dataset.create_and_management'],
  ['/datasets/create-from-pipeline', 'dataset.create_and_management'],
  ['/datasets/create/draft', 'dataset.create_and_management'],
  ['/datasets/connect', 'dataset.external.connect'],
  ['/datasets/connect/', 'dataset.external.connect'],
])('requires the matching permission for %s', async (pathname, permission) => {
  navigation.pathname = pathname
  const otherPermission =
    permission === 'dataset.external.connect'
      ? 'dataset.create_and_management'
      : 'dataset.external.connect'
  const { unmount } = render(<DatasetsLayout>Datasets content</DatasetsLayout>, {
    workspacePermissionKeys: [otherPermission],
  })
  expect(screen.queryByText('Datasets content')).not.toBeInTheDocument()
  await waitFor(() => expect(navigation.replace).toHaveBeenCalledWith('/datasets'))
  unmount()
  navigation.replace.mockClear()
  render(<DatasetsLayout>Datasets content</DatasetsLayout>, {
    workspacePermissionKeys: [permission],
  })
  expect(screen.getByText('Datasets content')).toBeInTheDocument()
  expect(navigation.replace).not.toHaveBeenCalled()
})
