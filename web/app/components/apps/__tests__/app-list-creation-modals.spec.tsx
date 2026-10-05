import type { DynamicOptions, Loader } from 'next/dynamic'
import type { ComponentProps } from 'react'
import { screen, waitFor } from '@testing-library/react'
import { renderWithConsoleQuery as render } from '@/test/console/query-data'
import { AppListCreationModals } from '../app-list-creation-modals'

const { loadDynamic, transport } = vi.hoisted(() => ({ loadDynamic: vi.fn(), transport: vi.fn() }))
vi.mock('@/service/console/browser', () => ({ consoleBrowserLink: { call: transport } }))
vi.mock('@/next/navigation', () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn() }),
  useParams: () => ({}),
}))
vi.mock('next/dynamic', async (importOriginal) => {
  const actual = await importOriginal<typeof import('next/dynamic')>()
  return {
    ...actual,
    default: <Props,>(
      loader: DynamicOptions<Props> | Loader<Props>,
      options?: DynamicOptions<Props>,
    ) => {
      if (typeof loader !== 'function') return actual.default(loader, options)
      return actual.default(() => {
        loadDynamic()
        return loader()
      }, options)
    },
  }
})

it('runs each actual dynamic loader only on its first activation and keeps other creation flows lazy', async () => {
  transport.mockImplementation(async (path: string[]) => {
    if (path.join('.') === 'explore.apps.get') return { recommended_apps: [], categories: [] }
    throw new Error(`Unexpected request: ${path.join('.')}`)
  })
  const props: ComponentProps<typeof AppListCreationModals> = {
    canCreateApp: true,
    category: 'all',
    dialog: null,
    onClose: vi.fn(),
    onOpenBlank: vi.fn(),
    onOpenTemplate: vi.fn(),
  }
  const { rerender } = render(<AppListCreationModals {...props} />)
  expect(loadDynamic).not.toHaveBeenCalled()
  let loaded = 0
  for (const type of ['blank', 'template', 'dsl'] as const) {
    rerender(<AppListCreationModals {...props} dialog={{ type }} />)
    await screen.findByRole('dialog')
    expect(loadDynamic).toHaveBeenCalledTimes(++loaded)
    rerender(<AppListCreationModals {...props} />)
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
    expect(loadDynamic).toHaveBeenCalledTimes(loaded)
    rerender(<AppListCreationModals {...props} dialog={{ type }} />)
    await screen.findByRole('dialog')
    expect(loadDynamic).toHaveBeenCalledTimes(loaded)
    rerender(<AppListCreationModals {...props} />)
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
  }
})
