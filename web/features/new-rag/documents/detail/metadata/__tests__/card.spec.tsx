import type { atom } from 'jotai'
import type { DocumentMetadataField } from '../../../metadata/editor-model'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { createStore, Provider } from 'jotai'
import { DocumentMetadataCard } from '../card'

type TestDocument = {
  id: string
  rowVersion: number
  userMetadata: Record<string, unknown>
}

type PatchRequest = { body: { expectedRowVersion: number; patch: Record<string, unknown> } }

const mocks = vi.hoisted(() => ({
  createMetadataField: vi.fn(),
  patchDocumentMetadata: vi.fn(),
  push: vi.fn(),
  toast: { error: vi.fn(), success: vi.fn() },
}))

const atoms = vi.hoisted(() => ({
  canEdit: undefined as unknown,
  document: undefined as unknown,
  knowledgeSpaceId: undefined as unknown,
}))

vi.mock('../../state/inputs', async () => {
  const { atom } = await import('jotai')
  atoms.knowledgeSpaceId = atom('space-1')
  return { documentDetailKnowledgeSpaceIdAtom: atoms.knowledgeSpaceId }
})
vi.mock('../../state/queries', async () => {
  const { atom } = await import('jotai')
  atoms.document = atom<TestDocument>({ id: 'document-1', rowVersion: 2, userMetadata: {} })
  return { documentDetailDocumentAtom: atoms.document }
})
vi.mock('../../state/workflow', async () => {
  const { atom } = await import('jotai')
  atoms.canEdit = atom(true)
  return { documentCanEditAtom: atoms.canEdit }
})
vi.mock('../../../models', () => ({
  logicalDocumentFromApi: (document: TestDocument) => document,
}))
vi.mock('@/app/notifications', () => ({ toast: mocks.toast }))
vi.mock('@/next/navigation', () => ({ useRouter: () => ({ push: mocks.push }) }))

const metadataFields = vi.hoisted(() => ({ current: [] as DocumentMetadataField[] }))
vi.mock('@/service/knowledge-fs/metadata', () => ({
  knowledgeFsMetadataFieldsQueryOptions: () => ({
    queryFn: async () => metadataFields.current,
    queryKey: ['knowledge-fs', 'metadata-fields'],
  }),
}))
vi.mock('@/service/console', () => ({
  consoleClient: {
    knowledgeFs: {
      spaces: {
        byControlSpaceId: {
          documents: { byDocumentId: { patch: mocks.patchDocumentMetadata } },
          metadata: { post: mocks.createMetadataField },
        },
      },
    },
  },
  consoleQuery: {
    knowledgeFs: {
      spaces: {
        byControlSpaceId: {
          logicalDocuments: {
            byDocumentId: { get: { key: () => ['knowledge-fs', 'document'] } },
            get: { key: () => ['knowledge-fs', 'documents'] },
          },
          metadata: { get: { key: () => ['knowledge-fs', 'metadata-fields'] } },
        },
      },
    },
  },
}))

const metadataField = (overrides: Partial<DocumentMetadataField> = {}): DocumentMetadataField => ({
  count: 1,
  createdAt: '2026-08-10T10:00:00Z',
  id: 'metadata-field-1',
  name: 'category',
  rowVersion: 0,
  type: 'string',
  updatedAt: '2026-08-10T10:00:00Z',
  ...overrides,
})

function deferred<T>() {
  let resolve!: (value: T) => void
  let reject!: (error: unknown) => void
  const promise = new Promise<T>((res, rej) => {
    resolve = res
    reject = rej
  })
  return { promise, reject, resolve }
}

function renderCard(userMetadata: Record<string, unknown>) {
  const store = createStore()
  const documentAtom = atoms.document as ReturnType<typeof atom<TestDocument>>
  store.set(documentAtom, { id: 'document-1', rowVersion: 2, userMetadata })
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  render(
    <QueryClientProvider client={queryClient}>
      <Provider store={store}>
        <DocumentMetadataCard />
      </Provider>
    </QueryClientProvider>,
  )
  return { queryClient }
}

async function openCreateForm(user: ReturnType<typeof userEvent.setup>) {
  await user.click(screen.getByRole('button', { name: 'common.operation.edit' }))
  await user.click(screen.getByRole('button', { name: 'dataset.metadata.addMetadata' }))
  await user.click(
    await screen.findByRole('button', { name: 'dataset.metadata.selectMetadata.newAction' }),
  )
  return screen.getByRole('textbox', { name: 'dataset.metadata.createMetadata.name' })
}

describe('DocumentMetadataCard', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    metadataFields.current = []
    mocks.patchDocumentMetadata.mockImplementation(async ({ body }: PatchRequest) => ({
      id: 'document-1',
      rowVersion: body.expectedRowVersion + 1,
      userMetadata: body.patch,
    }))
    mocks.createMetadataField.mockResolvedValue({})
  })

  it('saves untouched timestamps unchanged after opening the editor', async () => {
    const user = userEvent.setup()
    metadataFields.current = [metadataField({ name: 'reviewed_at', type: 'time' })]
    renderCard({ category: 'support', reviewed_at: '2026-08-04T10:00:45.123Z' })

    await user.click(screen.getByRole('button', { name: 'common.operation.edit' }))
    const category = screen.getByRole('textbox', { name: 'category' })
    await user.clear(category)
    await user.type(category, 'security')
    await user.click(screen.getByRole('button', { name: 'common.operation.save' }))

    expect(mocks.patchDocumentMetadata).toHaveBeenCalledWith({
      body: { expectedRowVersion: 2, patch: { category: 'security' } },
      params: { control_space_id: 'space-1', document_id: 'document-1' },
    })
  })

  it('closes without a request when only an untouched timestamp is present', async () => {
    const user = userEvent.setup()
    renderCard({ reviewed_at: '2026-08-04T10:00:45.123Z' })

    await user.click(screen.getByRole('button', { name: 'common.operation.edit' }))
    await user.click(screen.getByRole('button', { name: 'common.operation.save' }))

    expect(mocks.patchDocumentMetadata).not.toHaveBeenCalled()
    expect(screen.queryByLabelText('reviewed_at')).not.toBeInTheDocument()
  })

  it('locks draft controls while a save is pending', async () => {
    const user = userEvent.setup()
    const pendingSave = deferred<TestDocument>()
    mocks.patchDocumentMetadata.mockReturnValueOnce(pendingSave.promise)
    renderCard({ category: 'support', owner: 'alice' })

    await user.click(screen.getByRole('button', { name: 'common.operation.edit' }))
    const category = screen.getByRole('textbox', { name: 'category' })
    await user.clear(category)
    await user.type(category, 'security')
    await user.click(screen.getByRole('button', { name: 'common.operation.save' }))

    const owner = screen.getByRole('textbox', { name: 'owner' })
    expect(owner).toBeDisabled()
    expect(category).toBeDisabled()
    expect(screen.getByRole('button', { name: 'common.operation.remove owner' })).toBeDisabled()
    expect(screen.getByRole('button', { name: 'dataset.metadata.addMetadata' })).toBeDisabled()
    await user.type(owner, 'bob')
    expect(owner).toHaveValue('alice')

    pendingSave.resolve({ id: 'document-1', rowVersion: 3, userMetadata: {} })
    await waitFor(() =>
      expect(mocks.toast.success).toHaveBeenCalledWith('common.api.actionSuccess'),
    )
    expect(mocks.patchDocumentMetadata).toHaveBeenCalledOnce()
  })

  it('submits the editor through its form so keyboard submission saves', async () => {
    const user = userEvent.setup()
    renderCard({ category: 'support' })

    await user.click(screen.getByRole('button', { name: 'common.operation.edit' }))
    const category = screen.getByRole('textbox', { name: 'category' })
    const form = category.closest('form')
    expect(form).not.toBeNull()
    expect(within(form!).getByRole('button', { name: 'common.operation.save' })).toHaveAttribute(
      'type',
      'submit',
    )
    expect(within(form!).getByRole('button', { name: 'common.operation.cancel' })).toHaveAttribute(
      'type',
      'button',
    )
    expect(
      within(form!).getByRole('button', { name: 'common.operation.remove category' }),
    ).toHaveAttribute('type', 'button')
    expect(
      within(form!).getByRole('button', { name: 'dataset.metadata.addMetadata' }),
    ).toHaveAttribute('type', 'button')

    await user.clear(category)
    await user.type(category, 'security{Enter}')

    expect(mocks.patchDocumentMetadata).toHaveBeenCalledWith({
      body: { expectedRowVersion: 2, patch: { category: 'security' } },
      params: { control_space_id: 'space-1', document_id: 'document-1' },
    })
  })

  it('creates a field without submitting the surrounding metadata editor', async () => {
    const user = userEvent.setup()
    renderCard({ category: 'support' })

    const nameInput = await openCreateForm(user)
    await user.type(nameInput, 'priority{Enter}')

    await waitFor(() => expect(screen.getByLabelText('priority')).toBeInTheDocument())
    expect(mocks.createMetadataField).toHaveBeenCalledOnce()
    expect(mocks.patchDocumentMetadata).toHaveBeenCalledOnce()
    expect(mocks.patchDocumentMetadata).toHaveBeenCalledWith(
      expect.objectContaining({ body: { expectedRowVersion: 2, patch: { priority: '' } } }),
    )
    expect(screen.getByRole('textbox', { name: 'category' })).toBeInTheDocument()
  })

  it('creates the field again when the previous creation request failed', async () => {
    const user = userEvent.setup()
    mocks.createMetadataField.mockRejectedValueOnce(new Error('create failed'))
    renderCard({})

    await user.click(
      screen.getByRole('button', { name: 'dataset.metadata.documentMetadata.startLabeling' }),
    )
    await user.click(screen.getByRole('button', { name: 'dataset.metadata.addMetadata' }))
    await user.click(
      await screen.findByRole('button', { name: 'dataset.metadata.selectMetadata.newAction' }),
    )
    const nameInput = screen.getByRole('textbox', { name: 'dataset.metadata.createMetadata.name' })
    await user.type(nameInput, 'priority{Enter}')
    await waitFor(() =>
      expect(mocks.toast.error).toHaveBeenCalledWith('knowledgeSpace.settings.saveFailed'),
    )
    expect(mocks.patchDocumentMetadata).not.toHaveBeenCalled()

    await user.click(
      within(nameInput.closest('form')!).getByRole('button', { name: 'common.operation.save' }),
    )

    await waitFor(() => expect(mocks.createMetadataField).toHaveBeenCalledTimes(2))
    expect(mocks.patchDocumentMetadata).toHaveBeenCalledOnce()
  })

  it('skips creation on retry only after the field was created', async () => {
    const user = userEvent.setup()
    mocks.patchDocumentMetadata.mockRejectedValueOnce(new Error('update failed'))
    renderCard({})

    await user.click(
      screen.getByRole('button', { name: 'dataset.metadata.documentMetadata.startLabeling' }),
    )
    await user.click(screen.getByRole('button', { name: 'dataset.metadata.addMetadata' }))
    await user.click(
      await screen.findByRole('button', { name: 'dataset.metadata.selectMetadata.newAction' }),
    )
    const nameInput = screen.getByRole('textbox', { name: 'dataset.metadata.createMetadata.name' })
    await user.type(nameInput, 'priority{Enter}')
    await waitFor(() =>
      expect(mocks.toast.error).toHaveBeenCalledWith('knowledgeSpace.settings.saveFailed'),
    )
    metadataFields.current = [metadataField({ name: 'priority' })]

    await user.click(
      within(nameInput.closest('form')!).getByRole('button', { name: 'common.operation.save' }),
    )

    await waitFor(() => expect(mocks.patchDocumentMetadata).toHaveBeenCalledTimes(2))
    expect(mocks.createMetadataField).toHaveBeenCalledOnce()
  })

  it('shows translated metadata type names in the picker and create form', async () => {
    const user = userEvent.setup()
    metadataFields.current = [metadataField({ name: 'priority', type: 'number' })]
    renderCard({ category: 'support' })

    await user.click(screen.getByRole('button', { name: 'common.operation.edit' }))
    await user.click(screen.getByRole('button', { name: 'dataset.metadata.addMetadata' }))
    const option = await screen.findByRole('option', { name: /priority/ })
    expect(option).toHaveTextContent('dataset.metadata.type.number')

    await user.click(
      screen.getByRole('button', { name: 'dataset.metadata.selectMetadata.newAction' }),
    )
    for (const type of ['string', 'number', 'time'])
      expect(
        screen.getByRole('button', { name: `dataset.metadata.type.${type}` }),
      ).toBeInTheDocument()
  })
})
