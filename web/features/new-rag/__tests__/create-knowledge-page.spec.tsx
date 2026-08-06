import type { ReactNode } from 'react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { CreateKnowledgePage } from '../create-knowledge-page'
import { newKnowledgeSourceDraftStorageKey } from '../routes'

const serviceMock = vi.hoisted(() => ({
  create: vi.fn(),
  getDefaultModel: vi.fn(),
  upload: vi.fn(),
  uploadBulk: vi.fn(),
  listKey: vi.fn(() => ['console', 'knowledgeFs', 'listKnowledgeSpaces']),
}))

const routerMock = vi.hoisted(() => ({
  back: vi.fn(),
  replace: vi.fn(),
}))

const navigationMock = vi.hoisted(() => ({
  startMode: null as string | null,
}))

const permissionStateMock = vi.hoisted(() => ({
  atom: Symbol('datasetDefaultPermissionKeysAtom'),
  keys: ['dataset.acl.access_config'],
}))

const systemFeaturesStateMock = vi.hoisted(() => ({
  uploadAtom: Symbol('knowledgeFsUploadEnabledAtom'),
  rbacAtom: Symbol('rbacEnabledAtom'),
  uploadEnabled: true,
  rbacEnabled: true,
}))

vi.mock('@/next/navigation', () => ({
  useRouter: () => routerMock,
  useSearchParams: () => ({
    get: (key: string) => (key === 'start' ? navigationMock.startMode : null),
  }),
}))

vi.mock('@/context/permission-state', () => ({
  datasetDefaultPermissionKeysAtom: permissionStateMock.atom,
}))

vi.mock('@/features/system-features/state', () => ({
  knowledgeFsUploadEnabledAtom: systemFeaturesStateMock.uploadAtom,
  rbacEnabledAtom: systemFeaturesStateMock.rbacAtom,
}))

vi.mock('jotai', async (importOriginal) => {
  const original = await importOriginal<typeof import('jotai')>()
  return {
    ...original,
    useAtomValue: (atom: unknown) =>
      atom === permissionStateMock.atom
        ? permissionStateMock.keys
        : atom === systemFeaturesStateMock.uploadAtom
          ? systemFeaturesStateMock.uploadEnabled
          : atom === systemFeaturesStateMock.rbacAtom
            ? systemFeaturesStateMock.rbacEnabled
            : original.useAtomValue(atom as Parameters<typeof original.useAtomValue>[0]),
  }
})

vi.mock('@/service/client', () => ({
  consoleClient: {
    knowledgeFs: {
      spaces: {
        post: serviceMock.create,
      },
    },
    workspaces: {
      current: {
        defaultModel: {
          get: serviceMock.getDefaultModel,
        },
      },
    },
  },
  consoleQuery: {
    knowledgeFs: {
      spaces: {
        get: {
          key: serviceMock.listKey,
        },
      },
    },
  },
}))

const createdKnowledge = {
  control_space_id: 'e735c1dc-d2b8-4dc4-86dc-abaf2fb7d084',
  model_setup_required: false,
  operation_id: 'operation-1',
  state: 'provisioning' as const,
}

vi.mock('../knowledge-fs-upload', () => ({
  uploadKnowledgeFsDocuments: async (
    knowledgeSpaceId: string,
    uploads: Array<{ file: File; id: string }>,
  ) => {
    const files = uploads.map(({ file }) => file)
    if (files.length === 1)
      return serviceMock.upload({
        body: { file: files[0] },
        params: { control_space_id: knowledgeSpaceId },
      })
    return serviceMock.uploadBulk({
      body: { files },
      params: { control_space_id: knowledgeSpaceId },
    })
  },
}))

function renderPage(
  queryClient = new QueryClient({ defaultOptions: { mutations: { retry: false } } }),
) {
  const Wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
  )
  return { queryClient, ...render(<CreateKnowledgePage />, { wrapper: Wrapper }) }
}

async function fillRequiredFields(user: ReturnType<typeof userEvent.setup>) {
  await user.type(
    screen.getByRole('textbox', { name: 'dataset.newKnowledge.name' }),
    '  Product handbook  ',
  )
  await user.type(
    screen.getByRole('textbox', { name: /dataset\.newKnowledge\.description/ }),
    '  Internal answers  ',
  )
}

async function choosePermission(user: ReturnType<typeof userEvent.setup>, optionName: string) {
  await user.click(screen.getByRole('combobox', { name: 'dataset.newKnowledge.permission' }))
  await user.click(await screen.findByRole('option', { name: optionName }))
}

describe('CreateKnowledgePage', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    globalThis.sessionStorage.clear()
    serviceMock.create.mockResolvedValue(createdKnowledge)
    serviceMock.getDefaultModel.mockImplementation(({ query }: { query: { model_type: string } }) =>
      Promise.resolve({
        data: {
          model: query.model_type === 'llm' ? 'echo' : 'embed',
          model_type: query.model_type,
          provider: {
            provider:
              query.model_type === 'llm'
                ? 'kurokobo/fake_models/fake_models'
                : 'langgenius/cohere/cohere',
          },
        },
      }),
    )
    serviceMock.upload.mockResolvedValue({
      id: 'document-1',
    })
    serviceMock.uploadBulk.mockResolvedValue({
      accepted: 2,
      excluded: 0,
      items: [],
    })
    permissionStateMock.keys = ['dataset.acl.access_config']
    systemFeaturesStateMock.uploadEnabled = true
    systemFeaturesStateMock.rbacEnabled = true
    navigationMock.startMode = null
    vi.spyOn(globalThis.crypto, 'randomUUID').mockReturnValue(
      'a9c36c57-2d84-44d6-a36d-841f0d92a179',
    )
  })

  afterEach(() => {
    globalThis.sessionStorage.clear()
    vi.useRealTimers()
    vi.restoreAllMocks()
  })

  it('keeps create reachable and reports an empty knowledge name', async () => {
    const user = userEvent.setup()
    renderPage()

    const createButton = screen.getByRole('button', {
      name: 'dataset.newKnowledge.createTitle',
    })
    expect(createButton).toBeEnabled()

    await user.click(createButton)

    expect(await screen.findByText('dataset.newKnowledge.nameRequired')).toBeInTheDocument()
    expect(serviceMock.create).not.toHaveBeenCalled()
  })

  it('creates a private empty knowledge space, invalidates the list, and navigates', async () => {
    const user = userEvent.setup()
    const queryClient = new QueryClient({ defaultOptions: { mutations: { retry: false } } })
    const invalidate = vi.spyOn(queryClient, 'invalidateQueries')
    renderPage(queryClient)
    await fillRequiredFields(user)
    await choosePermission(user, 'dataset.newKnowledge.permissionOnlyMe')

    await user.click(screen.getByRole('button', { name: 'dataset.newKnowledge.createTitle' }))

    await waitFor(() => {
      expect(serviceMock.create).toHaveBeenCalledWith({
        body: {
          description: 'Internal answers',
          embedding: {
            model: 'embed',
            plugin_id: 'langgenius/cohere',
            provider: 'cohere',
          },
          idempotency_key: 'a9c36c57-2d84-44d6-a36d-841f0d92a179',
          name: 'Product handbook',
          retrieval: {
            default_mode: 'fast',
            reasoning_model: {
              model: 'echo',
              plugin_id: 'kurokobo/fake_models',
              provider: 'fake_models',
            },
            rerank: { enabled: false },
            score_threshold: { enabled: false, stage: 'mode-final' },
            top_k: 10,
          },
          slug: 'product-handbook-a9c36c572d84',
          visibility: 'only_me',
        },
      })
    })
    expect(invalidate).toHaveBeenCalledWith({
      queryKey: ['console', 'knowledgeFs', 'listKnowledgeSpaces'],
    })
    expect(routerMock.replace).toHaveBeenCalledWith(
      '/datasets/new/e735c1dc-d2b8-4dc4-86dc-abaf2fb7d084/sources',
    )
  })

  it('creates the default all-members visibility atomically', async () => {
    const user = userEvent.setup()
    renderPage()
    await fillRequiredFields(user)
    expect(
      screen.getByRole('combobox', { name: 'dataset.newKnowledge.permission' }),
    ).toHaveTextContent('dataset.newKnowledge.permissionAllMembers')

    await user.click(screen.getByRole('button', { name: 'dataset.newKnowledge.createTitle' }))

    await waitFor(() => {
      expect(serviceMock.create).toHaveBeenCalledWith({
        body: expect.objectContaining({ visibility: 'all_team_members' }),
      })
    })
  })

  it('keeps the legacy private default editable when RBAC is disabled', async () => {
    const user = userEvent.setup()
    permissionStateMock.keys = []
    systemFeaturesStateMock.rbacEnabled = false
    renderPage()
    await fillRequiredFields(user)

    const permission = screen.getByRole('combobox', {
      name: 'dataset.newKnowledge.permission',
    })
    expect(permission).toBeEnabled()
    expect(permission).toHaveTextContent('dataset.newKnowledge.permissionOnlyMe')
    expect(screen.queryByText('dataset.newKnowledge.permissionRestricted')).not.toBeInTheDocument()

    await choosePermission(user, 'dataset.newKnowledge.permissionAllMembers')
    await user.click(screen.getByRole('button', { name: 'dataset.newKnowledge.createTitle' }))

    await waitFor(() => expect(serviceMock.create).toHaveBeenCalledOnce())
    expect(serviceMock.create).toHaveBeenCalledWith({
      body: expect.objectContaining({ visibility: 'all_team_members' }),
    })
  })

  it('forces RBAC users without access-config permission to create a private space', async () => {
    const user = userEvent.setup()
    permissionStateMock.keys = []
    renderPage()
    await fillRequiredFields(user)

    const permission = screen.getByRole('combobox', {
      name: 'dataset.newKnowledge.permission',
    })
    expect(permission).toBeDisabled()
    expect(permission).toHaveTextContent('dataset.newKnowledge.permissionOnlyMe')
    expect(permission).toHaveAccessibleDescription('dataset.newKnowledge.permissionRestricted')
    expect(screen.getByText('dataset.newKnowledge.permissionRestricted')).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'dataset.newKnowledge.createTitle' }))

    await waitFor(() => expect(serviceMock.create).toHaveBeenCalledOnce())
    expect(serviceMock.create).toHaveBeenCalledWith({
      body: expect.objectContaining({ visibility: 'only_me' }),
    })
  })

  it('prevents duplicate pending submissions', async () => {
    const user = userEvent.setup()
    let resolveCreate: (value: typeof createdKnowledge) => void = () => undefined
    serviceMock.create.mockImplementation(
      () =>
        new Promise((resolve) => {
          resolveCreate = resolve
        }),
    )
    renderPage()
    await fillRequiredFields(user)
    const createButton = screen.getByRole('button', {
      name: 'dataset.newKnowledge.createTitle',
    })

    await user.dblClick(createButton)

    expect(serviceMock.create).toHaveBeenCalledOnce()
    expect(createButton).toHaveAttribute('aria-disabled', 'true')
    resolveCreate(createdKnowledge)
  })

  it('keeps the same idempotency key for a safe retry after failure', async () => {
    const user = userEvent.setup()
    serviceMock.create.mockRejectedValueOnce(new Error('upstream unavailable'))
    renderPage()
    await fillRequiredFields(user)

    await user.click(screen.getByRole('button', { name: 'dataset.newKnowledge.createTitle' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('dataset.newKnowledge.createFailed')
    expect(screen.getByRole('textbox', { name: 'dataset.newKnowledge.name' })).toBeDisabled()
    await user.click(screen.getByRole('button', { name: 'dataset.newKnowledge.createTitle' }))

    await waitFor(() => expect(serviceMock.create).toHaveBeenCalledTimes(2))
    expect(serviceMock.create.mock.calls[0]?.[0].body.idempotency_key).toBe(
      serviceMock.create.mock.calls[1]?.[0].body.idempotency_key,
    )
  })

  it('creates an empty knowledge base when a default model is missing', async () => {
    const user = userEvent.setup()
    serviceMock.create.mockResolvedValueOnce({
      ...createdKnowledge,
      model_setup_required: true,
    })
    vi.mocked(globalThis.crypto.randomUUID).mockReturnValueOnce(
      '11111111-1111-4111-8111-111111111111',
    )
    serviceMock.getDefaultModel.mockImplementation(({ query }: { query: { model_type: string } }) =>
      Promise.resolve(
        query.model_type === 'llm'
          ? {
              data: {
                model: 'echo',
                provider: { provider: 'kurokobo/fake_models/fake_models' },
              },
            }
          : { data: null },
      ),
    )
    renderPage()
    await fillRequiredFields(user)

    await user.click(screen.getByRole('button', { name: 'dataset.newKnowledge.createTitle' }))

    await waitFor(() => expect(serviceMock.create).toHaveBeenCalledOnce())
    expect(serviceMock.create).toHaveBeenCalledWith({
      body: expect.not.objectContaining({
        embedding: expect.anything(),
        retrieval: expect.anything(),
      }),
    })
    expect(routerMock.replace).toHaveBeenCalledWith(
      `/datasets/new/${createdKnowledge.control_space_id}/sources`,
    )
  })

  it('creates without model presets when loading default models fails', async () => {
    const user = userEvent.setup()
    serviceMock.create.mockResolvedValueOnce({
      ...createdKnowledge,
      model_setup_required: true,
    })
    serviceMock.getDefaultModel.mockRejectedValue(new Error('model service unavailable'))
    renderPage()
    await fillRequiredFields(user)

    await user.click(screen.getByRole('button', { name: 'dataset.newKnowledge.createTitle' }))

    await waitFor(() => expect(serviceMock.create).toHaveBeenCalledOnce())
    expect(serviceMock.create).toHaveBeenCalledWith({
      body: expect.not.objectContaining({
        embedding: expect.anything(),
        retrieval: expect.anything(),
      }),
    })
  })

  it('creates the space but prompts for model setup before uploading', async () => {
    const user = userEvent.setup()
    navigationMock.startMode = 'upload'
    serviceMock.create.mockResolvedValueOnce({
      ...createdKnowledge,
      model_setup_required: true,
    })
    serviceMock.getDefaultModel.mockResolvedValue({ data: null })
    renderPage()
    await fillRequiredFields(user)
    await user.upload(
      screen.getByLabelText('dataset.newKnowledge.uploadFiles', {
        selector: 'input[type="file"]',
      }),
      new File(['content'], 'guide.txt', { type: 'text/plain' }),
    )

    await user.click(screen.getByRole('button', { name: 'dataset.newKnowledge.createTitle' }))

    expect(await screen.findByRole('alertdialog')).toHaveTextContent(
      'common.modelProvider.toBeConfigured',
    )
    expect(serviceMock.create).toHaveBeenCalledOnce()
    expect(serviceMock.upload).not.toHaveBeenCalled()

    await user.click(
      screen.getByRole('button', { name: 'common.modelProvider.selector.configure' }),
    )
    expect(routerMock.replace).toHaveBeenCalledWith(
      `/datasets/new/${createdKnowledge.control_space_id}/settings`,
    )
  })

  it.each([400, 401, 403, 422])(
    'unlocks editable fields and rotates the idempotency key after a definitive %s rejection',
    async (status) => {
      const user = userEvent.setup()
      vi.mocked(globalThis.crypto.randomUUID)
        .mockReturnValueOnce('11111111-1111-4111-8111-111111111111')
        .mockReturnValueOnce('22222222-2222-4222-8222-222222222222')
      serviceMock.create.mockRejectedValueOnce({ status })
      renderPage()
      await fillRequiredFields(user)

      await user.click(screen.getByRole('button', { name: 'dataset.newKnowledge.createTitle' }))
      expect(await screen.findByRole('alert')).toHaveTextContent(
        'dataset.newKnowledge.createFailed',
      )
      const nameInput = screen.getByRole('textbox', { name: 'dataset.newKnowledge.name' })
      expect(nameInput).toBeEnabled()
      await user.clear(nameInput)
      await user.type(nameInput, 'Updated handbook')
      await user.click(screen.getByRole('button', { name: 'dataset.newKnowledge.createTitle' }))

      await waitFor(() => expect(serviceMock.create).toHaveBeenCalledTimes(2))
      expect(serviceMock.create.mock.calls[0]?.[0].body.idempotency_key).toBe(
        '11111111-1111-4111-8111-111111111111',
      )
      expect(serviceMock.create.mock.calls[1]?.[0].body).toMatchObject({
        idempotency_key: '22222222-2222-4222-8222-222222222222',
        name: 'Updated handbook',
      })
    },
  )

  it.each([409, 429, 503])(
    'keeps request identity frozen after an ambiguous %s response',
    async (status) => {
      const user = userEvent.setup()
      serviceMock.create.mockRejectedValueOnce({ status })
      renderPage()
      await fillRequiredFields(user)

      await user.click(screen.getByRole('button', { name: 'dataset.newKnowledge.createTitle' }))
      expect(await screen.findByRole('alert')).toHaveTextContent(
        'dataset.newKnowledge.createFailed',
      )
      expect(screen.getByRole('textbox', { name: 'dataset.newKnowledge.name' })).toBeDisabled()
      expect(
        screen.getByRole('combobox', { name: 'dataset.newKnowledge.permission' }),
      ).toBeDisabled()
      await user.click(screen.getByRole('button', { name: 'dataset.newKnowledge.createTitle' }))

      await waitFor(() => expect(serviceMock.create).toHaveBeenCalledTimes(2))
      expect(serviceMock.create.mock.calls[0]?.[0].body.idempotency_key).toBe(
        serviceMock.create.mock.calls[1]?.[0].body.idempotency_key,
      )
    },
  )

  it('safely resumes a downstream upload after the control space is created', async () => {
    const user = userEvent.setup()
    navigationMock.startMode = 'upload'
    const queryClient = new QueryClient({ defaultOptions: { mutations: { retry: false } } })
    const invalidate = vi.spyOn(queryClient, 'invalidateQueries')
    serviceMock.upload.mockRejectedValueOnce(new Error('upload unavailable'))
    renderPage(queryClient)
    await user.upload(
      screen.getByLabelText('dataset.newKnowledge.uploadFiles', {
        selector: 'input[type="file"]',
      }),
      new File(['content'], 'handbook.md', { type: 'text/markdown' }),
    )
    await fillRequiredFields(user)

    await user.click(screen.getByRole('button', { name: 'dataset.newKnowledge.createTitle' }))
    expect(await screen.findByRole('alert')).toHaveTextContent(
      'dataset.newKnowledge.documentUploadFailed',
    )
    expect(invalidate).toHaveBeenCalledWith({
      queryKey: ['console', 'knowledgeFs', 'listKnowledgeSpaces'],
    })
    const nameInput = screen.getByRole('textbox', { name: 'dataset.newKnowledge.name' })
    expect(nameInput).toBeDisabled()
    expect(screen.getByRole('combobox', { name: 'dataset.newKnowledge.permission' })).toBeDisabled()
    await user.type(nameInput, ' changed')
    await user.click(screen.getByRole('button', { name: 'dataset.newKnowledge.createTitle' }))

    await waitFor(() => expect(serviceMock.upload).toHaveBeenCalledTimes(2))
    expect(serviceMock.create).toHaveBeenCalledOnce()
    expect(routerMock.replace).toHaveBeenCalledWith(
      '/datasets/new/e735c1dc-d2b8-4dc4-86dc-abaf2fb7d084/documents',
    )
  })

  it('converges after an atomic creation response is lost', async () => {
    const user = userEvent.setup()
    serviceMock.create.mockRejectedValueOnce(new Error('response lost'))
    renderPage()
    await fillRequiredFields(user)

    await user.click(screen.getByRole('button', { name: 'dataset.newKnowledge.createTitle' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('dataset.newKnowledge.createFailed')
    await user.click(screen.getByRole('button', { name: 'dataset.newKnowledge.createTitle' }))

    await waitFor(() => expect(routerMock.replace).toHaveBeenCalledOnce())
    expect(serviceMock.create).toHaveBeenCalledTimes(2)
    expect(serviceMock.create.mock.calls[0]?.[0].body.idempotency_key).toBe(
      serviceMock.create.mock.calls[1]?.[0].body.idempotency_key,
    )
  })

  it('keeps every start mode interactive without simulating backend success', async () => {
    const user = userEvent.setup()
    renderPage()

    const startEmpty = screen.getByRole('radio', { name: 'dataset.newKnowledge.startEmpty' })
    expect(startEmpty).toBeChecked()
    expect(startEmpty).toHaveAccessibleDescription('dataset.newKnowledge.startEmptyDescription')
    const connectSource = screen.getByRole('radio', {
      name: 'dataset.newKnowledge.connectSource',
    })
    const uploadFiles = screen.getByRole('radio', { name: 'dataset.newKnowledge.uploadFiles' })
    expect(connectSource).toBeEnabled()
    expect(uploadFiles).toBeEnabled()

    await user.click(connectSource)
    expect(connectSource).toBeChecked()
    expect(screen.getByRole('radio', { name: 'dataset.newKnowledge.websiteCrawl' })).toBeChecked()
    expect(screen.getByRole('radio', { name: 'Firecrawl' })).toBeChecked()
    for (const unavailableProvider of ['Jina Reader', 'WaterCrawl', 'FakeCrawler']) {
      await user.click(screen.getByRole('radio', { name: unavailableProvider }))
      expect(screen.getByRole('radio', { name: unavailableProvider })).toBeChecked()
    }
    expect(screen.getByRole('button', { name: 'dataset.newKnowledge.moreProviders' })).toBeEnabled()
    expect(screen.getByText('dataset.newKnowledge.crawlOptions')).toBeInTheDocument()
    expect(
      screen.getByRole('button', { name: 'dataset.newKnowledge.crawlAndPreview' }),
    ).toBeDisabled()
    expect(screen.getByText('dataset.newKnowledge.pagesAppearTitle')).toBeInTheDocument()
    expect(screen.getByText('dataset.newKnowledge.usingDefaults')).toBeInTheDocument()
    const rootUrl = screen.getByPlaceholderText('dataset.newKnowledge.rootUrlPlaceholder')
    const sourceName = screen.getByPlaceholderText('dataset.newKnowledge.sourceNamePlaceholder')
    expect(rootUrl).toBeEnabled()
    expect(sourceName).toBeEnabled()
    await user.type(rootUrl, 'https://docs.dify.ai')
    await user.type(sourceName, 'Dify docs')
    const crawlAndPreview = screen.getByRole('button', {
      name: 'dataset.newKnowledge.crawlAndPreview',
    })
    expect(crawlAndPreview).toBeEnabled()
    await user.click(crawlAndPreview)
    expect(screen.getByRole('alert')).toHaveTextContent(
      'dataset.newKnowledge.sourceSetupBackendDependency',
    )
    expect(screen.queryByText(/^dataset\.newKnowledge\.crawlingPages/)).not.toBeInTheDocument()
    expect(screen.queryByText(/^dataset\.newKnowledge\.pagesCrawled/)).not.toBeInTheDocument()
    const onlineDocuments = screen.getByRole('radio', {
      name: 'dataset.newKnowledge.onlineDocuments',
    })
    await user.click(onlineDocuments)
    expect(onlineDocuments).toBeChecked()
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
    expect(screen.getByText('Notion')).toBeInTheDocument()
    expect(screen.getByText('dataset.newKnowledge.notionNotConnected')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'dataset.newKnowledge.connectNotion' })).toBeEnabled()
    expect(
      screen.queryByRole('textbox', { name: 'dataset.newKnowledge.sourceName' }),
    ).not.toBeInTheDocument()
    expect(
      screen.queryByRole('combobox', { name: 'dataset.newKnowledge.syncPolicy' }),
    ).not.toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'dataset.newKnowledge.connectNotion' }))
    expect(screen.getByRole('alert')).toHaveTextContent(
      'dataset.newKnowledge.sourceSetupBackendDependency',
    )
    await user.click(screen.getByRole('radio', { name: 'Google Docs' }))
    expect(screen.getByRole('textbox', { name: 'dataset.newKnowledge.sourceName' })).toBeEnabled()
    expect(screen.getByRole('combobox', { name: 'dataset.newKnowledge.syncPolicy' })).toBeEnabled()
    await user.click(uploadFiles)
    expect(uploadFiles).toBeChecked()
    const uploadInput = screen.getByLabelText('dataset.newKnowledge.uploadFiles', {
      selector: 'input[type="file"]',
    })
    expect(uploadInput).toBeInTheDocument()
    expect(uploadInput).not.toHaveAttribute('hidden')
    expect(uploadInput.nextElementSibling).toHaveClass('peer-focus-visible:ring-2')
    uploadInput.focus()
    expect(uploadInput).toHaveFocus()
    expect(screen.getByRole('button', { name: 'dataset.newKnowledge.createTitle' })).toBeDisabled()
  })

  it('disables upload before creating a space when direct upload is unavailable', () => {
    navigationMock.startMode = 'upload'
    systemFeaturesStateMock.uploadEnabled = false

    renderPage()

    expect(screen.getByRole('radio', { name: 'dataset.newKnowledge.startEmpty' })).toBeChecked()
    const uploadFiles = screen.getByRole('radio', { name: 'dataset.newKnowledge.uploadFiles' })
    expect(uploadFiles).toBeDisabled()
    expect(uploadFiles).toHaveAccessibleDescription(
      'dataset.newKnowledge.uploadFilesDescription dataset.cornerLabel.unavailable',
    )
    expect(serviceMock.create).not.toHaveBeenCalled()
  })

  it('continues from the upload mode after real creation succeeds', async () => {
    const user = userEvent.setup()
    navigationMock.startMode = 'upload'
    renderPage()

    expect(screen.getByRole('radio', { name: 'dataset.newKnowledge.uploadFiles' })).toBeChecked()
    await user.upload(
      screen.getByLabelText('dataset.newKnowledge.uploadFiles', {
        selector: 'input[type="file"]',
      }),
      new File(['content'], 'handbook.md', { type: 'text/markdown' }),
    )
    await fillRequiredFields(user)
    await choosePermission(user, 'dataset.newKnowledge.permissionOnlyMe')
    await user.click(screen.getByRole('button', { name: 'dataset.newKnowledge.createTitle' }))

    await waitFor(() =>
      expect(routerMock.replace).toHaveBeenCalledWith(
        '/datasets/new/e735c1dc-d2b8-4dc4-86dc-abaf2fb7d084/documents',
      ),
    )
    expect(serviceMock.upload).toHaveBeenCalledWith({
      body: { file: expect.objectContaining({ name: 'handbook.md' }) },
      params: { control_space_id: createdKnowledge.control_space_id },
    })
  })

  it('queues uploads when native random UUID generation is unavailable', async () => {
    const user = userEvent.setup()
    navigationMock.startMode = 'upload'
    vi.restoreAllMocks()
    const descriptor = Object.getOwnPropertyDescriptor(globalThis.crypto, 'randomUUID')
    Object.defineProperty(globalThis.crypto, 'randomUUID', {
      configurable: true,
      value: undefined,
    })

    try {
      renderPage()
      await user.upload(
        screen.getByLabelText('dataset.newKnowledge.uploadFiles', {
          selector: 'input[type="file"]',
        }),
        new File(['content'], 'handbook.md', { type: 'text/markdown' }),
      )

      expect(screen.getByText('handbook.md')).toBeInTheDocument()
    } finally {
      if (descriptor) Object.defineProperty(globalThis.crypto, 'randomUUID', descriptor)
      else Reflect.deleteProperty(globalThis.crypto, 'randomUUID')
    }
  })

  it('hands the configured website draft to the real add-source workflow', async () => {
    const user = userEvent.setup()
    navigationMock.startMode = 'source'
    renderPage()
    await fillRequiredFields(user)
    await user.type(
      screen.getByPlaceholderText('dataset.newKnowledge.rootUrlPlaceholder'),
      'https://docs.dify.ai',
    )
    await user.type(
      screen.getByPlaceholderText('dataset.newKnowledge.sourceNamePlaceholder'),
      'Dify docs',
    )
    await user.keyboard('{Enter}')
    expect(serviceMock.create).not.toHaveBeenCalled()
    await user.click(screen.getByRole('button', { name: 'dataset.newKnowledge.crawlOptions' }))
    await user.click(screen.getByRole('checkbox', { name: 'dataset.newKnowledge.includeSubpages' }))
    const maxPages = screen.getByRole('textbox', { name: 'dataset.newKnowledge.maxPages' })
    await user.clear(maxPages)
    await user.type(maxPages, '25')
    await user.click(screen.getByRole('button', { name: 'dataset.newKnowledge.crawlOptions' }))
    expect(
      screen.getByText(
        'dataset.newKnowledge.includeSubpages: dataset.newKnowledge.booleanFalse · dataset.newKnowledge.maxPages: 25',
      ),
    ).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'dataset.newKnowledge.createTitle' }))

    await waitFor(() =>
      expect(routerMock.replace).toHaveBeenCalledWith(
        '/datasets/new/e735c1dc-d2b8-4dc4-86dc-abaf2fb7d084/sources/new?type=websiteCrawl&draft=a9c36c57-2d84-44d6-a36d-841f0d92a179',
      ),
    )
    expect(
      JSON.parse(
        globalThis.sessionStorage.getItem(
          newKnowledgeSourceDraftStorageKey('a9c36c57-2d84-44d6-a36d-841f0d92a179'),
        ) ?? '',
      ),
    ).toEqual({
      includeSubpages: false,
      maxPages: 25,
      provider: 'Firecrawl',
      rootUrl: 'https://docs.dify.ai',
      sourceName: 'Dify docs',
      sourceType: 'websiteCrawl',
      syncPolicy: 'provider',
    })
  })

  it('preserves online document configuration across the real navigation boundary', async () => {
    const user = userEvent.setup()
    navigationMock.startMode = 'source'
    renderPage()
    await fillRequiredFields(user)
    await user.click(screen.getByRole('radio', { name: 'dataset.newKnowledge.onlineDocuments' }))
    await user.click(screen.getByRole('radio', { name: 'Google Docs' }))
    await user.type(
      screen.getByRole('textbox', { name: 'dataset.newKnowledge.sourceName' }),
      'Shared product docs',
    )
    await user.click(screen.getByRole('combobox', { name: 'dataset.newKnowledge.syncPolicy' }))
    await user.click(screen.getByRole('option', { name: 'dataset.newKnowledge.syncPolicyDaily' }))
    await user.click(screen.getByRole('button', { name: 'dataset.newKnowledge.createTitle' }))

    await waitFor(() =>
      expect(routerMock.replace).toHaveBeenCalledWith(
        '/datasets/new/e735c1dc-d2b8-4dc4-86dc-abaf2fb7d084/sources/new?type=onlineDocuments&draft=a9c36c57-2d84-44d6-a36d-841f0d92a179',
      ),
    )
    expect(
      JSON.parse(
        globalThis.sessionStorage.getItem(
          newKnowledgeSourceDraftStorageKey('a9c36c57-2d84-44d6-a36d-841f0d92a179'),
        ) ?? '',
      ),
    ).toEqual({
      provider: 'Google Docs',
      sourceName: 'Shared product docs',
      sourceType: 'onlineDocuments',
      syncPolicy: 'daily',
    })
  })

  it('keeps each source type draft when the user switches between them', async () => {
    const user = userEvent.setup()
    navigationMock.startMode = 'source'
    renderPage()
    await user.type(
      screen.getByPlaceholderText('dataset.newKnowledge.rootUrlPlaceholder'),
      'https://docs.dify.ai',
    )
    await user.type(
      screen.getByPlaceholderText('dataset.newKnowledge.sourceNamePlaceholder'),
      'Website docs',
    )

    await user.click(screen.getByRole('radio', { name: 'dataset.newKnowledge.onlineDocuments' }))
    await user.click(screen.getByRole('radio', { name: 'Google Docs' }))
    expect(screen.getByRole('textbox', { name: 'dataset.newKnowledge.sourceName' })).toBeEnabled()
    await user.type(
      screen.getByRole('textbox', { name: 'dataset.newKnowledge.sourceName' }),
      'Notion docs',
    )
    await user.click(screen.getByRole('radio', { name: 'dataset.newKnowledge.websiteCrawl' }))

    expect(screen.getByPlaceholderText('dataset.newKnowledge.rootUrlPlaceholder')).toHaveValue(
      'https://docs.dify.ai',
    )
    expect(screen.getByPlaceholderText('dataset.newKnowledge.sourceNamePlaceholder')).toHaveValue(
      'Website docs',
    )
  })

  it('uses the same website validation as the add-source workflow', async () => {
    const user = userEvent.setup()
    navigationMock.startMode = 'source'
    renderPage()
    await fillRequiredFields(user)
    const rootUrl = screen.getByPlaceholderText('dataset.newKnowledge.rootUrlPlaceholder')
    const sourceName = screen.getByPlaceholderText('dataset.newKnowledge.sourceNamePlaceholder')
    expect(rootUrl).toHaveAttribute('maxlength', '2048')
    expect(sourceName).toHaveAttribute('maxlength', '200')

    await user.type(rootUrl, 'https://user:secret@docs.dify.ai')
    await user.type(sourceName, 'Dify docs')
    expect(screen.getByRole('button', { name: 'dataset.newKnowledge.createTitle' })).toBeDisabled()
    await user.click(screen.getByRole('button', { name: 'dataset.newKnowledge.createTitle' }))
    expect(serviceMock.create).not.toHaveBeenCalled()

    await user.clear(rootUrl)
    await user.type(rootUrl, 'https://docs.dify.ai')
    expect(screen.getByRole('button', { name: 'dataset.newKnowledge.createTitle' })).toBeEnabled()
  })

  it('keeps an invalid upload visible and prevents creating the knowledge space', async () => {
    const user = userEvent.setup()
    navigationMock.startMode = 'upload'
    renderPage()
    await fillRequiredFields(user)
    const oversizedFile = new File(['content'], 'oversized.pdf', { type: 'application/pdf' })
    Object.defineProperty(oversizedFile, 'size', { value: 16 * 1024 * 1024 })
    await user.upload(
      screen.getByLabelText('dataset.newKnowledge.uploadFiles', {
        selector: 'input[type="file"]',
      }),
      oversizedFile,
    )

    expect(screen.getByText('oversized.pdf')).toBeInTheDocument()
    expect(
      screen.getByText(/dataset\.newKnowledge\.documentUploadExclusion\.fileSize/),
    ).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'dataset.newKnowledge.createTitle' })).toBeDisabled()
    expect(screen.queryByRole('button', { name: 'dataset.newKnowledge.preview' })).toBeNull()
    expect(serviceMock.create).not.toHaveBeenCalled()
  })

  it('shows the real uploading state on each valid file row', async () => {
    const user = userEvent.setup()
    navigationMock.startMode = 'upload'
    serviceMock.upload.mockImplementation(() => new Promise(() => {}))
    renderPage()
    await fillRequiredFields(user)
    await user.upload(
      screen.getByLabelText('dataset.newKnowledge.uploadFiles', {
        selector: 'input[type="file"]',
      }),
      new File(['content'], 'handbook.md', { type: 'text/markdown' }),
    )
    const queue = screen.getByRole('list', { name: 'dataset.newKnowledge.uploadFiles' })
    const preview = within(queue).getByRole('button', { name: 'dataset.newKnowledge.preview' })
    expect(preview).toBeEnabled()
    expect(screen.queryByText('dataset.newKnowledge.previewUnavailable')).not.toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: 'dataset.newKnowledge.createTitle' }))

    expect(await within(queue).findByText('dataset.newKnowledge.uploadingFiles')).toBeVisible()
    expect(within(queue).queryByRole('button', { name: 'dataset.newKnowledge.preview' })).toBeNull()
  })

  it('previews a selected file locally without uploading it', () => {
    navigationMock.startMode = 'upload'
    const file = new File(['local content'], 'handbook.md', { type: 'text/markdown' })
    const createObjectUrl = vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:handbook')
    const revokeObjectUrl = vi.spyOn(URL, 'revokeObjectURL')
    const open = vi.spyOn(globalThis, 'open').mockReturnValue(null)
    vi.useFakeTimers()
    renderPage()

    fireEvent.change(
      screen.getByLabelText('dataset.newKnowledge.uploadFiles', {
        selector: 'input[type="file"]',
      }),
      { target: { files: [file] } },
    )
    fireEvent.click(screen.getByRole('button', { name: 'dataset.newKnowledge.preview' }))

    expect(createObjectUrl).toHaveBeenCalledWith(expect.any(Blob))
    expect((createObjectUrl.mock.calls[0]?.[0] as Blob).type).toBe('text/plain')
    expect(open).toHaveBeenCalledWith('blob:handbook', '_blank', 'noopener,noreferrer')
    expect(serviceMock.upload).not.toHaveBeenCalled()
    expect(revokeObjectUrl).not.toHaveBeenCalled()

    vi.advanceTimersByTime(60_000)
    expect(revokeObjectUrl).toHaveBeenCalledWith('blob:handbook')
  })

  it('retries upload without creating a duplicate knowledge space', async () => {
    const user = userEvent.setup()
    navigationMock.startMode = 'upload'
    serviceMock.upload.mockRejectedValueOnce(new Error('KnowledgeFS unavailable'))
    renderPage()
    await fillRequiredFields(user)
    await user.upload(
      screen.getByLabelText('dataset.newKnowledge.uploadFiles', {
        selector: 'input[type="file"]',
      }),
      new File(['content'], 'handbook.md', { type: 'text/markdown' }),
    )

    await user.click(screen.getByRole('button', { name: 'dataset.newKnowledge.createTitle' }))
    expect(await screen.findByRole('alert')).toHaveTextContent(
      'dataset.newKnowledge.documentUploadFailed',
    )
    await user.click(screen.getByRole('button', { name: 'dataset.newKnowledge.createTitle' }))

    await waitFor(() => expect(routerMock.replace).toHaveBeenCalled())
    expect(serviceMock.create).toHaveBeenCalledOnce()
    expect(serviceMock.upload).toHaveBeenCalledTimes(2)
  })

  it('hands the configured source draft to the add-source workflow after creation', async () => {
    const user = userEvent.setup()
    navigationMock.startMode = 'source'
    renderPage()
    await fillRequiredFields(user)
    await user.type(
      screen.getByPlaceholderText('dataset.newKnowledge.rootUrlPlaceholder'),
      'https://docs.dify.ai',
    )
    await user.type(
      screen.getByPlaceholderText('dataset.newKnowledge.sourceNamePlaceholder'),
      'Dify docs',
    )
    await user.click(screen.getByRole('button', { name: 'dataset.newKnowledge.crawlOptions' }))
    await user.click(screen.getByRole('checkbox', { name: 'dataset.newKnowledge.includeSubpages' }))
    const maxPages = screen.getByRole('textbox', { name: 'dataset.newKnowledge.maxPages' })
    await user.clear(maxPages)
    await user.type(maxPages, '25')

    await user.click(screen.getByRole('button', { name: 'dataset.newKnowledge.createTitle' }))

    await waitFor(() =>
      expect(routerMock.replace).toHaveBeenCalledWith(
        '/datasets/new/e735c1dc-d2b8-4dc4-86dc-abaf2fb7d084/sources/new?type=websiteCrawl&draft=a9c36c57-2d84-44d6-a36d-841f0d92a179',
      ),
    )
    expect(
      JSON.parse(
        globalThis.sessionStorage.getItem(
          newKnowledgeSourceDraftStorageKey('a9c36c57-2d84-44d6-a36d-841f0d92a179'),
        ) ?? '',
      ),
    ).toEqual({
      includeSubpages: false,
      maxPages: 25,
      provider: 'Firecrawl',
      rootUrl: 'https://docs.dify.ai',
      sourceName: 'Dify docs',
      sourceType: 'websiteCrawl',
      syncPolicy: 'provider',
    })
  })

  it('renders the approved creation modal and exposes both dismiss actions', async () => {
    const user = userEvent.setup()
    renderPage()

    const dialog = screen.getByRole('dialog', {
      name: 'dataset.newKnowledge.createTitle',
    })
    expect(
      within(dialog).getByRole('heading', { name: 'dataset.newKnowledge.createTitle' }),
    ).toBeInTheDocument()
    expect(screen.getByPlaceholderText('dataset.newKnowledge.namePlaceholder')).toBeInTheDocument()
    expect(
      screen.getByPlaceholderText('dataset.newKnowledge.descriptionPlaceholder'),
    ).toBeInTheDocument()
    expect(screen.getByText('dataset.newKnowledge.descriptionHelp')).toBeInTheDocument()
    expect(screen.getByText('dataset.newKnowledge.startWithHelp')).toBeInTheDocument()
    expect(
      screen.getByRole('button', { name: 'dataset.newKnowledge.createTitle' }),
    ).toBeInTheDocument()
    expect(screen.getByText('dataset.newKnowledge.illustrationHeadline')).toBeInTheDocument()
    expect(document.querySelector('.bg-background-overlay-backdrop')).toBeInTheDocument()

    await user.keyboard('{Escape}')
    expect(routerMock.replace).toHaveBeenCalledWith('/datasets?view=new')
    routerMock.replace.mockClear()

    await user.click(screen.getByRole('button', { name: 'common.operation.close' }))
    expect(routerMock.replace).toHaveBeenCalledWith('/datasets?view=new')
    routerMock.replace.mockClear()

    await user.click(screen.getByRole('button', { name: 'common.operation.cancel' }))
    expect(routerMock.replace).toHaveBeenCalledWith('/datasets?view=new')
  })

  it('asks before discarding an unsaved draft', async () => {
    const user = userEvent.setup()
    const historyBack = vi.spyOn(window.history, 'back').mockImplementation(() => undefined)
    renderPage()
    await user.type(
      screen.getByRole('textbox', { name: 'dataset.newKnowledge.name' }),
      'Draft knowledge',
    )

    await user.click(screen.getByRole('button', { name: 'common.operation.close' }))

    expect(routerMock.back).not.toHaveBeenCalled()
    const confirmation = await screen.findByRole('alertdialog', {
      name: 'dataset.newKnowledge.discardDraftTitle',
    })
    expect(confirmation).toHaveTextContent('dataset.newKnowledge.discardDraftDescription')
    await user.click(
      within(confirmation).getByRole('button', {
        name: 'dataset.newKnowledge.discardDraftConfirm',
      }),
    )
    expect(historyBack).toHaveBeenCalledOnce()

    act(() => window.dispatchEvent(new PopStateEvent('popstate')))

    expect(routerMock.replace).toHaveBeenCalledWith('/datasets?view=new')
  })

  it('asks before discarding a preserved source draft after switching source types', async () => {
    const user = userEvent.setup()
    navigationMock.startMode = 'source'
    renderPage()

    await user.click(screen.getByRole('radio', { name: 'dataset.newKnowledge.onlineDocuments' }))
    await user.click(screen.getByRole('radio', { name: 'Google Docs' }))
    await user.type(
      screen.getByPlaceholderText('dataset.newKnowledge.sourceNamePlaceholder'),
      'Release notes',
    )
    await user.click(screen.getByRole('radio', { name: 'dataset.newKnowledge.websiteCrawl' }))
    await user.click(screen.getByRole('button', { name: 'common.operation.close' }))

    expect(
      await screen.findByRole('alertdialog', {
        name: 'dataset.newKnowledge.discardDraftTitle',
      }),
    ).toBeInTheDocument()
    expect(routerMock.replace).not.toHaveBeenCalled()
  })

  it('protects an unsaved draft from browser unload', async () => {
    const user = userEvent.setup()
    renderPage()
    await user.type(
      screen.getByRole('textbox', { name: 'dataset.newKnowledge.name' }),
      'Draft knowledge',
    )
    const event = new Event('beforeunload', { cancelable: true })

    act(() => window.dispatchEvent(event))

    expect(event.defaultPrevented).toBe(true)
  })

  it('asks before leaving an unsaved draft with browser Back', async () => {
    const user = userEvent.setup()
    renderPage()
    await user.type(
      screen.getByRole('textbox', { name: 'dataset.newKnowledge.name' }),
      'Draft knowledge',
    )

    act(() => window.dispatchEvent(new PopStateEvent('popstate')))

    const confirmation = await screen.findByRole('alertdialog', {
      name: 'dataset.newKnowledge.discardDraftTitle',
    })
    await user.click(
      within(confirmation).getByRole('button', {
        name: 'dataset.newKnowledge.discardDraftConfirm',
      }),
    )

    expect(routerMock.replace).toHaveBeenCalledWith('/datasets?view=new')
  })

  it('does not warn after a draft is cleared before browser Back', async () => {
    const user = userEvent.setup()
    renderPage()
    const nameInput = screen.getByRole('textbox', { name: 'dataset.newKnowledge.name' })
    await user.type(nameInput, 'Draft knowledge')
    await user.clear(nameInput)

    act(() => window.dispatchEvent(new PopStateEvent('popstate')))

    expect(
      screen.queryByRole('alertdialog', {
        name: 'dataset.newKnowledge.discardDraftTitle',
      }),
    ).not.toBeInTheDocument()
    expect(routerMock.replace).toHaveBeenCalledWith('/datasets?view=new')
  })

  it('warns before leaving a partially created knowledge space', async () => {
    const user = userEvent.setup()
    navigationMock.startMode = 'upload'
    serviceMock.upload.mockRejectedValueOnce(new Error('upload unavailable'))
    renderPage()
    await user.upload(
      screen.getByLabelText('dataset.newKnowledge.uploadFiles', {
        selector: 'input[type="file"]',
      }),
      new File(['content'], 'handbook.md', { type: 'text/markdown' }),
    )
    await fillRequiredFields(user)

    await user.click(screen.getByRole('button', { name: 'dataset.newKnowledge.createTitle' }))
    expect(await screen.findByText('dataset.newKnowledge.documentUploadFailed')).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: 'common.operation.cancel' }))

    expect(routerMock.back).not.toHaveBeenCalled()
    const confirmation = await screen.findByRole('alertdialog', {
      name: 'dataset.newKnowledge.leavePartialSetupTitle',
    })
    expect(confirmation).toHaveTextContent('dataset.newKnowledge.leavePartialSetupDescription')
    await user.click(
      within(confirmation).getByRole('button', {
        name: 'dataset.newKnowledge.leavePartialSetupConfirm',
      }),
    )
    expect(routerMock.replace).toHaveBeenCalledWith(
      '/datasets/new/e735c1dc-d2b8-4dc4-86dc-abaf2fb7d084/sources',
    )
  })
})
