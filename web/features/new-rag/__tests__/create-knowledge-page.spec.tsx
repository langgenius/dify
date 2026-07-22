import type { ReactNode } from 'react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { CreateKnowledgePage } from '../create-knowledge-page'
import { newKnowledgeSourceDraftStorageKey } from '../routes'

const serviceMock = vi.hoisted(() => ({
  create: vi.fn(),
  getPolicy: vi.fn(),
  patchPolicy: vi.fn(),
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
  atom: Symbol('workspacePermissionKeysAtom'),
  keys: ['dataset.create_and_management', 'dataset.acl.access_config'],
}))

vi.mock('@/next/navigation', () => ({
  useRouter: () => routerMock,
  useSearchParams: () => ({
    get: (key: string) => (key === 'start' ? navigationMock.startMode : null),
  }),
}))

vi.mock('@/context/permission-state', () => ({
  workspacePermissionKeysAtom: permissionStateMock.atom,
}))

vi.mock('jotai', async (importOriginal) => {
  const original = await importOriginal<typeof import('jotai')>()
  return {
    ...original,
    useAtomValue: (atom: unknown) =>
      atom === permissionStateMock.atom
        ? permissionStateMock.keys
        : original.useAtomValue(atom as Parameters<typeof original.useAtomValue>[0]),
  }
})

vi.mock('@/service/client', () => ({
  consoleClient: {
    knowledgeFs: {
      createKnowledgeSpace: serviceMock.create,
      getKnowledgeSpacesByIdAccessPolicy: serviceMock.getPolicy,
      patchKnowledgeSpacesByIdAccessPolicy: serviceMock.patchPolicy,
      postKnowledgeSpacesByIdDocuments: serviceMock.upload,
      postKnowledgeSpacesByIdDocumentsBulk: serviceMock.uploadBulk,
    },
  },
  consoleQuery: {
    knowledgeFs: {
      listKnowledgeSpaces: {
        key: serviceMock.listKey,
      },
    },
  },
}))

const createdKnowledge = {
  configurationStatus: 'ready',
  createdAt: '2026-07-20T00:00:00Z',
  id: 'e735c1dc-d2b8-4dc4-86dc-abaf2fb7d084',
  name: 'Product handbook',
  revision: 1,
  slug: 'product-handbook',
  tenantId: 'tenant-1',
  updatedAt: '2026-07-20T00:00:00Z',
}

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
    serviceMock.getPolicy.mockResolvedValue({
      id: 'policy-1',
      ownerSubjectId: 'user-1',
      partialMemberSubjectIds: [],
      revision: 4,
      visibility: 'only_me',
    })
    serviceMock.patchPolicy.mockResolvedValue({
      id: 'policy-1',
      ownerSubjectId: 'user-1',
      partialMemberSubjectIds: [],
      revision: 5,
      visibility: 'all_members',
    })
    serviceMock.upload.mockResolvedValue({
      id: 'document-1',
    })
    serviceMock.uploadBulk.mockResolvedValue({
      accepted: 2,
      excluded: 0,
      items: [],
    })
    permissionStateMock.keys = ['dataset.create_and_management', 'dataset.acl.access_config']
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

  it('validates the required trimmed name before calling KnowledgeFS', async () => {
    const user = userEvent.setup()
    renderPage()

    await user.type(screen.getByRole('textbox', { name: 'dataset.newKnowledge.name' }), '   ')
    await user.click(screen.getByRole('button', { name: 'dataset.newKnowledge.createTitle' }))

    expect(serviceMock.create).not.toHaveBeenCalled()
    expect(screen.getByText('dataset.newKnowledge.nameRequired')).toBeInTheDocument()
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
          idempotencyKey: 'a9c36c57-2d84-44d6-a36d-841f0d92a179',
          name: 'Product handbook',
        },
      })
    })
    expect(serviceMock.getPolicy).not.toHaveBeenCalled()
    expect(invalidate).toHaveBeenCalledWith({
      queryKey: ['console', 'knowledgeFs', 'listKnowledgeSpaces'],
    })
    expect(routerMock.replace).toHaveBeenCalledWith(
      '/datasets/new/e735c1dc-d2b8-4dc4-86dc-abaf2fb7d084/sources',
    )
  })

  it('defaults authorized users to the Figma all-members policy and updates its revision', async () => {
    const user = userEvent.setup()
    renderPage()
    await fillRequiredFields(user)
    expect(
      screen.getByRole('combobox', { name: 'dataset.newKnowledge.permission' }),
    ).toHaveTextContent('dataset.newKnowledge.permissionAllMembers')

    await user.click(screen.getByRole('button', { name: 'dataset.newKnowledge.createTitle' }))

    await waitFor(() => {
      expect(serviceMock.patchPolicy).toHaveBeenCalledWith({
        body: {
          expectedRevision: 4,
          partialMemberSubjectIds: [],
          visibility: 'all_members',
        },
        params: { id: createdKnowledge.id },
      })
    })
  })

  it('forces users without access-config permission to create a private space', async () => {
    const user = userEvent.setup()
    permissionStateMock.keys = ['dataset.create_and_management']
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
    expect(serviceMock.getPolicy).not.toHaveBeenCalled()
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
    expect(serviceMock.create.mock.calls[0]?.[0].body.idempotencyKey).toBe(
      serviceMock.create.mock.calls[1]?.[0].body.idempotencyKey,
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
      expect(serviceMock.create.mock.calls[0]?.[0].body.idempotencyKey).toBe(
        '11111111-1111-4111-8111-111111111111',
      )
      expect(serviceMock.create.mock.calls[1]?.[0].body).toMatchObject({
        idempotencyKey: '22222222-2222-4222-8222-222222222222',
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
      expect(serviceMock.create.mock.calls[0]?.[0].body.idempotencyKey).toBe(
        serviceMock.create.mock.calls[1]?.[0].body.idempotencyKey,
      )
    },
  )

  it('safely resumes the permission step after a partial failure', async () => {
    const user = userEvent.setup()
    serviceMock.patchPolicy.mockRejectedValueOnce(new Error('policy update unavailable'))
    renderPage()
    await fillRequiredFields(user)

    await user.click(screen.getByRole('button', { name: 'dataset.newKnowledge.createTitle' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('dataset.newKnowledge.createFailed')
    const nameInput = screen.getByRole('textbox', { name: 'dataset.newKnowledge.name' })
    expect(nameInput).toBeDisabled()
    expect(screen.getByRole('combobox', { name: 'dataset.newKnowledge.permission' })).toBeDisabled()
    await user.type(nameInput, ' changed')
    await user.click(screen.getByRole('button', { name: 'dataset.newKnowledge.createTitle' }))

    await waitFor(() => expect(serviceMock.patchPolicy).toHaveBeenCalledTimes(2))
    expect(serviceMock.create).toHaveBeenCalledOnce()
    expect(routerMock.replace).toHaveBeenCalledWith(
      '/datasets/new/e735c1dc-d2b8-4dc4-86dc-abaf2fb7d084/sources',
    )
  })

  it('converges after a permission update succeeds but its response is lost', async () => {
    const user = userEvent.setup()
    serviceMock.getPolicy
      .mockResolvedValueOnce({
        id: 'policy-1',
        ownerSubjectId: 'user-1',
        partialMemberSubjectIds: [],
        revision: 4,
        visibility: 'only_me',
      })
      .mockResolvedValueOnce({
        id: 'policy-1',
        ownerSubjectId: 'user-1',
        partialMemberSubjectIds: [],
        revision: 5,
        visibility: 'all_members',
      })
    serviceMock.patchPolicy.mockRejectedValueOnce(new Error('response lost'))
    renderPage()
    await fillRequiredFields(user)

    await user.click(screen.getByRole('button', { name: 'dataset.newKnowledge.createTitle' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('dataset.newKnowledge.createFailed')
    await user.click(screen.getByRole('button', { name: 'dataset.newKnowledge.createTitle' }))

    await waitFor(() => expect(routerMock.replace).toHaveBeenCalledOnce())
    expect(serviceMock.create).toHaveBeenCalledOnce()
    expect(serviceMock.getPolicy).toHaveBeenCalledTimes(2)
    expect(serviceMock.patchPolicy).toHaveBeenCalledOnce()
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
    expect(screen.getByText('Notion')).toBeInTheDocument()
    expect(screen.getByText('dataset.newKnowledge.notionNotConnected')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'dataset.newKnowledge.connectNotion' })).toBeEnabled()
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

  it.each([
    ['source', '/datasets/new/e735c1dc-d2b8-4dc4-86dc-abaf2fb7d084/sources/new?type=websiteCrawl'],
    ['upload', '/datasets/new/e735c1dc-d2b8-4dc4-86dc-abaf2fb7d084/documents'],
  ])('continues from the %s mode after real creation succeeds', async (startMode, path) => {
    const user = userEvent.setup()
    navigationMock.startMode = startMode
    renderPage()

    expect(
      screen.getByRole('radio', {
        name:
          startMode === 'source'
            ? 'dataset.newKnowledge.connectSource'
            : 'dataset.newKnowledge.uploadFiles',
      }),
    ).toBeChecked()
    if (startMode === 'upload') {
      await user.upload(
        screen.getByLabelText('dataset.newKnowledge.uploadFiles', {
          selector: 'input[type="file"]',
        }),
        new File(['content'], 'handbook.md', { type: 'text/markdown' }),
      )
    }
    await fillRequiredFields(user)
    await choosePermission(user, 'dataset.newKnowledge.permissionOnlyMe')
    await user.click(screen.getByRole('button', { name: 'dataset.newKnowledge.createTitle' }))

    await waitFor(() => expect(routerMock.replace).toHaveBeenCalledWith(path))
    if (startMode === 'upload')
      expect(serviceMock.upload).toHaveBeenCalledWith({
        body: { file: expect.objectContaining({ name: 'handbook.md' }) },
        params: { id: createdKnowledge.id },
      })
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
    const maxPages = screen.getByRole('spinbutton', { name: 'dataset.newKnowledge.maxPages' })
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
    })
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
      screen.getByText('dataset.newKnowledge.documentUploadExclusion.fileSize'),
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
    expect(preview).toBeDisabled()
    expect(preview).toHaveAccessibleDescription('dataset.newKnowledge.previewUnavailable')
    expect(screen.getByText('dataset.newKnowledge.previewUnavailable')).toBeVisible()

    await user.click(screen.getByRole('button', { name: 'dataset.newKnowledge.createTitle' }))

    expect(await within(queue).findByText('dataset.newKnowledge.uploadingFiles')).toBeVisible()
    expect(within(queue).queryByRole('button', { name: 'dataset.newKnowledge.preview' })).toBeNull()
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

    await user.keyboard('{Escape}')
    expect(routerMock.back).toHaveBeenCalledOnce()
    routerMock.back.mockClear()

    await user.click(screen.getByRole('button', { name: 'common.operation.close' }))
    expect(routerMock.back).toHaveBeenCalledOnce()
    routerMock.back.mockClear()

    await user.click(screen.getByRole('button', { name: 'common.operation.cancel' }))
    expect(routerMock.back).toHaveBeenCalledOnce()
  })
})
