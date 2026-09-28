import type { AppDetailWithSite } from '@dify/contracts/api/console/apps/types.gen'
import type { ComponentType } from 'react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { lazy, Suspense } from 'react'
import { createAppDetailFixture } from '@/test/fixtures/app'
import { AppModeEnum } from '@/types/app'
import AppInfoModals from '../app-info-modals'

const mockImportDSL = vi.fn()
const mockCheckDependencies = vi.fn()
const mockFetchWorkflowDraft = vi.fn()

vi.mock('next/dynamic', () => ({
  default: (loader: () => Promise<{ default: ComponentType }>) => {
    const Component = lazy(loader)
    return (props: Record<string, unknown>) => (
      <Suspense fallback={null}>
        <Component {...props} />
      </Suspense>
    )
  },
}))

vi.mock('@/service/console', () => ({
  consoleQuery: {
    apps: {
      imports: {
        post: {
          mutationOptions: () => ({
            mutationFn: ({ body }: { body: unknown }) => mockImportDSL(body),
          }),
        },
        byImportId: {
          confirm: { post: { mutationOptions: () => ({ mutationFn: vi.fn() }) } },
        },
        byAppId: {
          checkDependencies: {
            get: {
              mutationOptions: () => ({
                mutationFn: ({ params }: { params: unknown }) => mockCheckDependencies(params),
              }),
            },
          },
        },
      },
    },
  },
}))

vi.mock('@/service/workflow', () => ({
  fetchWorkflowDraft: (path: string) => mockFetchWorkflowDraft(path),
}))

vi.mock('@/app/notifications', () => ({
  toast: { error: vi.fn(), success: vi.fn(), warning: vi.fn(), info: vi.fn() },
}))

const appDetail: AppDetailWithSite = createAppDetailFixture({
  id: 'app-1',
  mode: AppModeEnum.WORKFLOW,
})

it('imports DSL from the app sidebar without canvas providers', async () => {
  const user = userEvent.setup()
  const closeModal = vi.fn()
  const onImport = vi.fn()
  mockImportDSL.mockResolvedValue({ id: 'import-1', status: 'completed', app_id: 'app-1' })
  mockFetchWorkflowDraft.mockResolvedValue({
    graph: { nodes: [], edges: [], viewport: { x: 0, y: 0, zoom: 1 } },
    features: {},
    hash: 'imported-hash',
    conversation_variables: [],
    environment_variables: [],
  })
  mockCheckDependencies.mockResolvedValue({ leaked_dependencies: [] })

  const client = new QueryClient({ defaultOptions: { mutations: { retry: false } } })
  render(
    <QueryClientProvider client={client}>
      <AppInfoModals
        appDetail={appDetail}
        activeModal="importDSL"
        closeModal={closeModal}
        secretEnvList={[]}
        setSecretEnvList={vi.fn()}
        onEdit={vi.fn()}
        onCopy={vi.fn()}
        onImport={onImport}
        onExport={vi.fn(async () => true)}
        isExporting={false}
        exportCheck={vi.fn()}
        handleConfirmExport={vi.fn(async () => {})}
        onConfirmDelete={vi.fn()}
      />
    </QueryClientProvider>,
  )

  const input = await waitFor(
    () => {
      const fileInput = document.querySelector<HTMLInputElement>('input[type="file"]')
      if (!fileInput) throw new Error('Expected the DSL file input to load')
      return fileInput
    },
    { timeout: 3000 },
  )
  await user.upload(input, new File(['workflow'], 'workflow.ifpkg'))
  await user.click(screen.getByRole('button', { name: 'workflow.common.overwriteAndImport' }))

  await waitFor(() =>
    expect(mockImportDSL).toHaveBeenCalledWith({ file: expect.any(File), app_id: 'app-1' }),
  )
  await waitFor(() => expect(closeModal).toHaveBeenCalledOnce())
  expect(onImport).toHaveBeenCalledOnce()
})
