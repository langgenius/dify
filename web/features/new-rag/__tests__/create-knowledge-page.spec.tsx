import type { ReactNode } from 'react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { CreateKnowledgePage } from '../create-knowledge-page'

const serviceMock = vi.hoisted(() => ({
  crawlSource: vi.fn(),
  create: vi.fn(),
  createSource: vi.fn(),
  getPolicy: vi.fn(),
  patchPolicy: vi.fn(),
  uploadDocument: vi.fn(),
  sourceProvidersOptions: vi.fn(() => ({
    queryFn: async () => ({
      items: [
        {
          authKinds: ['api-key'],
          available: true,
          capabilities: ['website-crawl'],
          configuration: [],
          displayName: 'Firecrawl',
          id: 'firecrawl',
        },
      ],
    }),
    queryKey: ['console', 'knowledgeFs', 'sourceProviders'],
  })),
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
  keys: ['dataset.create_and_management', 'dataset.acl.access_config', 'dataset.external.connect'],
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
      postKnowledgeSpacesByIdSources: serviceMock.createSource,
      postKnowledgeSpacesByIdSourcesBySourceIdCrawl: serviceMock.crawlSource,
    },
  },
  consoleQuery: {
    knowledgeFs: {
      getSourceProviders: {
        queryOptions: serviceMock.sourceProvidersOptions,
      },
      listKnowledgeSpaces: {
        key: serviceMock.listKey,
      },
    },
  },
}))

vi.mock('../service', () => ({
  uploadKnowledgeDocument: serviceMock.uploadDocument,
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
    serviceMock.createSource.mockResolvedValue({
      id: 'source-1',
      knowledgeSpaceId: createdKnowledge.id,
      metadata: {},
      name: 'Product docs',
      status: 'active',
      type: 'web',
      uri: 'https://docs.example.com',
    })
    serviceMock.crawlSource.mockResolvedValue({
      pages: [{ content: 'Docs', sourceUrl: 'https://docs.example.com', title: 'Docs' }],
      total: 1,
    })
    serviceMock.uploadDocument.mockResolvedValue({
      id: 'document-1',
      filename: 'handbook.pdf',
    })
    permissionStateMock.keys = [
      'dataset.create_and_management',
      'dataset.acl.access_config',
      'dataset.external.connect',
    ]
    navigationMock.startMode = null
    vi.spyOn(globalThis.crypto, 'randomUUID').mockReturnValue(
      'a9c36c57-2d84-44d6-a36d-841f0d92a179',
    )
  })

  afterEach(() => {
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
    expect(screen.getByRole('radio', { name: 'dataset.newKnowledge.connectSource' })).toBeDisabled()
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

  it('renders the source configuration when Connect a source is selected', async () => {
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
    expect(
      screen.getByRole('textbox', { name: 'dataset.newKnowledge.sourceUrl' }),
    ).toBeInTheDocument()
    expect(
      screen.getByRole('textbox', { name: 'dataset.newKnowledge.sourceName' }),
    ).toBeInTheDocument()
    expect(
      screen.getByRole('button', { name: 'datasetCreation.stepOne.website.run' }),
    ).toBeInTheDocument()
  })

  it('creates and crawls a website source before opening Sources', async () => {
    const user = userEvent.setup()
    navigationMock.startMode = 'source'
    renderPage()

    await screen.findByRole('button', { name: 'Firecrawl' })
    await fillRequiredFields(user)
    await choosePermission(user, 'dataset.newKnowledge.permissionOnlyMe')
    await user.type(
      screen.getByRole('textbox', { name: 'dataset.newKnowledge.sourceUrl' }),
      'https://docs.example.com',
    )
    await user.type(
      screen.getByRole('textbox', { name: 'dataset.newKnowledge.sourceName' }),
      'Product docs',
    )
    await user.click(screen.getByRole('button', { name: 'dataset.newKnowledge.createTitle' }))

    await waitFor(() => {
      expect(serviceMock.createSource).toHaveBeenCalledWith({
        body: expect.objectContaining({
          name: 'Product docs',
          type: 'web',
          uri: 'https://docs.example.com/',
        }),
        params: { id: createdKnowledge.id },
      })
      expect(serviceMock.crawlSource).toHaveBeenCalledWith({
        params: { id: createdKnowledge.id, sourceId: 'source-1' },
      })
    })
    expect(routerMock.replace).toHaveBeenCalledWith(
      '/datasets/new/e735c1dc-d2b8-4dc4-86dc-abaf2fb7d084/sources',
    )
  })

  it('uploads selected files before opening Documents', async () => {
    const user = userEvent.setup()
    navigationMock.startMode = 'upload'
    renderPage()
    await fillRequiredFields(user)
    await choosePermission(user, 'dataset.newKnowledge.permissionOnlyMe')
    const file = new File(['handbook'], 'handbook.pdf', { type: 'application/pdf' })
    await user.upload(document.querySelector('input[type="file"]')!, file)

    expect(screen.getByText('handbook.pdf')).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'dataset.newKnowledge.createTitle' }))

    await waitFor(() => {
      expect(serviceMock.uploadDocument).toHaveBeenCalledWith({
        file,
        knowledgeSpaceId: createdKnowledge.id,
      })
    })
    expect(routerMock.replace).toHaveBeenCalledWith(
      '/datasets/new/e735c1dc-d2b8-4dc4-86dc-abaf2fb7d084/documents',
    )
  })

  it('confirms before discarding dirty form values', async () => {
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

    await user.type(
      screen.getByRole('textbox', { name: 'dataset.newKnowledge.name' }),
      'Draft knowledge',
    )
    await user.click(screen.getByRole('button', { name: 'common.operation.cancel' }))
    expect(routerMock.back).not.toHaveBeenCalled()
    expect(
      screen.getByRole('alertdialog', { name: 'dataset.newKnowledge.discardTitle' }),
    ).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'common.operation.confirm' }))
    expect(routerMock.back).toHaveBeenCalledOnce()
  })
})
