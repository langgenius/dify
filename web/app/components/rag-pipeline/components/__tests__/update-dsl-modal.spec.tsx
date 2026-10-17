import { act, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, expect, it, vi } from 'vite-plus/test'
import { renderEditor as render } from '@/app/components/workflow/editor-resource/__tests__/render'
import { DSLImportMode, DSLImportStatus } from '@/models/app'
import { createDeferred } from '@/test/deferred'
import UpdateDSLModal from '../update-dsl-modal'

const toastMocks = vi.hoisted(() => {
  const call = vi.fn()
  return {
    call,
    api: vi.fn((message: unknown, options?: Record<string, unknown>) =>
      call({ message, ...options }),
    ),
    dismiss: vi.fn(),
    update: vi.fn(),
    promise: vi.fn(),
  }
})

vi.mock('@/app/notifications', () => ({
  toast: Object.assign(toastMocks.api, {
    success: vi.fn((message: string, options?: Record<string, unknown>) =>
      toastMocks.call({ type: 'success', message, ...options }),
    ),
    error: vi.fn((message: string, options?: Record<string, unknown>) =>
      toastMocks.call({ type: 'error', message, ...options }),
    ),
    warning: vi.fn((message: string, options?: Record<string, unknown>) =>
      toastMocks.call({ type: 'warning', message, ...options }),
    ),
    info: vi.fn((message: string, options?: Record<string, unknown>) =>
      toastMocks.call({ type: 'info', message, ...options }),
    ),
    dismiss: toastMocks.dismiss,
    update: toastMocks.update,
    promise: toastMocks.promise,
  }),
}))
const mockEmit = vi.fn()
vi.mock('@/context/event-emitter', () => ({
  useEventEmitterContextContext: () => ({
    eventEmitter: { emit: mockEmit },
  }),
}))

vi.mock('@/app/components/workflow/store', () => ({
  useWorkflowStore: () => ({
    getState: () => ({
      pipelineId: 'test-pipeline-id',
    }),
  }),
}))

const mockHandleCheckPluginDependencies = vi.fn()
vi.mock('@/app/components/workflow/plugin-dependency/hooks', () => ({
  usePluginDependencies: () => ({
    handleCheckPluginDependencies: mockHandleCheckPluginDependencies,
  }),
}))

const mockImportDSL = vi.fn()
const mockImportDSLConfirm = vi.fn()
vi.mock('@/service/console', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/service/console')>()
  const { withConsoleResponses } = await import('@/test/console/service-responses')
  return {
    ...actual,
    consoleQuery: withConsoleResponses(actual.consoleQuery, {
      'rag.pipelines.imports.post': (input) => mockImportDSL(input),
      'rag.pipelines.imports.byImportId.confirm.post': (input) => mockImportDSLConfirm(input),
    }),
  }
})

vi.mock('@/service/workflow', () => ({
  fetchWorkflowDraft: vi.fn().mockResolvedValue({
    graph: { nodes: [], edges: [], viewport: { x: 0, y: 0, zoom: 1 } },
    hash: 'test-hash',
    rag_pipeline_variables: [],
  }),
}))

const setup = () => {
  const onCancel = vi.fn()
  const onBackup = vi.fn()
  const onImport = vi.fn()
  const view = render(
    <UpdateDSLModal onCancel={onCancel} onBackup={onBackup} onImport={onImport} />,
    {
      resource: { kind: 'knowledge-pipeline', pipelineId: 'test-pipeline-id' },
    },
  )
  return { ...view, onCancel, onBackup, onImport, user: userEvent.setup() }
}
const importButton = () =>
  screen.getByRole('button', { name: 'workflow.common.overwriteAndImport' })
const selectFile = async (user: ReturnType<typeof userEvent.setup>) => {
  const loaded = createDeferred<void>()
  const readAsText = FileReader.prototype.readAsText
  const spy = vi.spyOn(FileReader.prototype, 'readAsText').mockImplementation(function (
    this: FileReader,
    file,
    encoding,
  ) {
    this.addEventListener('loadend', () => loaded.resolve(), { once: true })
    readAsText.call(this, file, encoding)
  })
  try {
    await act(async () => {
      await user.upload(
        document.querySelector<HTMLInputElement>('input[type="file"]')!,
        new File(['pipeline: updated'], 'updated.pipeline', { type: 'text/yaml' }),
      )
      await loaded.promise
    })
  } finally {
    spy.mockRestore()
  }
}

beforeEach(() => {
  vi.clearAllMocks()
  mockImportDSL.mockReset().mockResolvedValue({
    id: 'import-id',
    status: DSLImportStatus.COMPLETED,
    pipeline_id: 'test-pipeline-id',
  })
  mockImportDSLConfirm
    .mockReset()
    .mockResolvedValue({ status: DSLImportStatus.COMPLETED, pipeline_id: 'test-pipeline-id' })
  mockHandleCheckPluginDependencies.mockResolvedValue(undefined)
})

it('backs up the current draft and allows cancellation without importing', async () => {
  const { user, onBackup, onCancel, onImport } = setup()
  await user.click(screen.getByRole('button', { name: 'workflow.common.backupCurrentDraft' }))
  expect(onBackup).toHaveBeenCalledOnce()
  await user.click(screen.getByRole('button', { name: 'app.newApp.Cancel' }))
  expect(onCancel).toHaveBeenCalledOnce()
  expect(mockImportDSL).not.toHaveBeenCalled()
  expect(onImport).not.toHaveBeenCalled()
})

it('enables import for an uploaded pipeline and disables it again after removal', async () => {
  const { user } = setup()
  expect(importButton()).toBeDisabled()
  await selectFile(user)
  expect(screen.getByText('updated.pipeline')).toBeInTheDocument()
  expect(importButton()).toBeEnabled()
  await user.click(screen.getByRole('button', { name: 'common.operation.delete' }))
  expect(screen.queryByText('updated.pipeline')).not.toBeInTheDocument()
  expect(importButton()).toBeDisabled()
  await user.click(importButton())
  expect(mockImportDSL).not.toHaveBeenCalled()
})

it('imports the uploaded contents and completes only after dependencies are checked', async () => {
  const pending = createDeferred<void>()
  mockHandleCheckPluginDependencies.mockReturnValue(pending.promise)
  const { user, onCancel, onImport } = setup()
  await selectFile(user)
  await user.click(importButton())
  await waitFor(() =>
    expect(mockHandleCheckPluginDependencies).toHaveBeenCalledWith('test-pipeline-id', true),
  )
  expect(mockImportDSL).toHaveBeenCalledExactlyOnceWith({
    body: {
      mode: DSLImportMode.YAML_CONTENT,
      yaml_content: 'pipeline: updated',
      pipeline_id: 'test-pipeline-id',
    },
  })
  expect(onImport).toHaveBeenCalledOnce()
  expect(onCancel).not.toHaveBeenCalled()
  await user.click(importButton())
  expect(mockImportDSL).toHaveBeenCalledOnce()
  await act(async () => pending.resolve())
  await waitFor(() => expect(onCancel).toHaveBeenCalledOnce())
})

it('keeps the selected file after an import failure and allows retry', async () => {
  mockImportDSL.mockResolvedValueOnce({
    id: 'import-id',
    status: DSLImportStatus.FAILED,
    error: 'Invalid pipeline',
  })
  const { user, onImport, onCancel } = setup()
  await selectFile(user)
  await user.click(importButton())
  await waitFor(() =>
    expect(toastMocks.call).toHaveBeenCalledWith({ type: 'error', message: 'Invalid pipeline' }),
  )
  expect(screen.getByText('updated.pipeline')).toBeInTheDocument()
  expect(onImport).not.toHaveBeenCalled()
  expect(onCancel).not.toHaveBeenCalled()
  await user.click(importButton())
  await waitFor(() => expect(onCancel).toHaveBeenCalledOnce())
  expect(mockImportDSL).toHaveBeenCalledTimes(2)
})

it.each(['Cancel', 'Confirm'] as const)(
  'shows mismatched versions and handles %s before applying the import',
  async (action) => {
    mockImportDSL.mockResolvedValue({
      id: 'import-id',
      status: DSLImportStatus.PENDING,
      pipeline_id: 'test-pipeline-id',
      imported_dsl_version: '1.0.0',
      current_dsl_version: '2.0.0',
    })
    const { user, onImport, onCancel } = setup()
    await selectFile(user)
    await user.click(importButton())
    const dialog = await screen.findByRole('alertdialog', {
      name: 'app.newApp.appCreateDSLErrorTitle',
    })
    expect(within(dialog).getByText('1.0.0')).toBeInTheDocument()
    expect(within(dialog).getByText('2.0.0')).toBeInTheDocument()
    expect(onImport).not.toHaveBeenCalled()
    await user.click(within(dialog).getByRole('button', { name: `app.newApp.${action}` }))
    if (action === 'Cancel') {
      await waitFor(() => expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument())
      expect(mockImportDSLConfirm).not.toHaveBeenCalled()
      expect(onImport).not.toHaveBeenCalled()
    } else {
      await waitFor(() => expect(onCancel).toHaveBeenCalledOnce())
      expect(mockImportDSLConfirm).toHaveBeenCalledExactlyOnceWith({
        params: { import_id: 'import-id' },
      })
      expect(onImport).toHaveBeenCalledOnce()
    }
  },
)
