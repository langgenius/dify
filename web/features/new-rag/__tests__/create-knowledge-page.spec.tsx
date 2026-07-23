import type { ReactNode } from 'react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { CreateKnowledgePage } from '../create-knowledge-page'

const serviceMock = vi.hoisted(() => ({
  create: vi.fn(),
  getPolicy: vi.fn(),
  patchPolicy: vi.fn(),
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
    permissionStateMock.keys = ['dataset.create_and_management', 'dataset.acl.access_config']
    navigationMock.startMode = null
    vi.spyOn(globalThis.crypto, 'randomUUID').mockReturnValue(
      'a9c36c57-2d84-44d6-a36d-841f0d92a179',
    )
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('keeps creation disabled until the trimmed knowledge name is present', async () => {
    const user = userEvent.setup()
    renderPage()

    const createButton = screen.getByRole('button', {
      name: 'dataset.newKnowledge.createTitle',
    })
    expect(createButton).toBeDisabled()

    await user.type(screen.getByRole('textbox', { name: 'dataset.newKnowledge.name' }), '   ')

    expect(createButton).toBeDisabled()
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
    const queryClient = new QueryClient({ defaultOptions: { mutations: { retry: false } } })
    const invalidate = vi.spyOn(queryClient, 'invalidateQueries')
    serviceMock.patchPolicy.mockRejectedValueOnce(new Error('policy update unavailable'))
    renderPage(queryClient)
    await fillRequiredFields(user)

    await user.click(screen.getByRole('button', { name: 'dataset.newKnowledge.createTitle' }))
    expect(await screen.findByRole('alert')).toHaveTextContent(
      'dataset.newKnowledge.permissionUpdateFailed',
    )
    expect(invalidate).toHaveBeenCalledWith({
      queryKey: ['console', 'knowledgeFs', 'listKnowledgeSpaces'],
    })
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
    expect(await screen.findByRole('alert')).toHaveTextContent(
      'dataset.newKnowledge.permissionUpdateFailed',
    )
    await user.click(screen.getByRole('button', { name: 'dataset.newKnowledge.createTitle' }))

    await waitFor(() => expect(routerMock.replace).toHaveBeenCalledOnce())
    expect(serviceMock.create).toHaveBeenCalledOnce()
    expect(serviceMock.getPolicy).toHaveBeenCalledTimes(2)
    expect(serviceMock.patchPolicy).toHaveBeenCalledOnce()
  })

  it('keeps source and upload disabled until their stacked flows land', () => {
    navigationMock.startMode = 'source'
    renderPage()

    const startEmpty = screen.getByRole('radio', { name: 'dataset.newKnowledge.startEmpty' })
    expect(startEmpty).toBeChecked()
    expect(startEmpty).toHaveAccessibleDescription('dataset.newKnowledge.startEmptyDescription')
    const connectSource = screen.getByRole('radio', {
      name: 'dataset.newKnowledge.connectSource',
    })
    const uploadFiles = screen.getByRole('radio', { name: 'dataset.newKnowledge.uploadFiles' })
    expect(connectSource).toBeDisabled()
    expect(connectSource).toHaveAccessibleDescription(
      'dataset.newKnowledge.connectSourceDescription dataset.cornerLabel.unavailable',
    )
    expect(uploadFiles).toBeDisabled()
    expect(uploadFiles).toHaveAccessibleDescription(
      'dataset.newKnowledge.uploadFilesDescription dataset.cornerLabel.unavailable',
    )
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
    expect(routerMock.back).toHaveBeenCalledOnce()
    routerMock.back.mockClear()

    await user.click(screen.getByRole('button', { name: 'common.operation.close' }))
    expect(routerMock.back).toHaveBeenCalledOnce()
    routerMock.back.mockClear()

    await user.click(screen.getByRole('button', { name: 'common.operation.cancel' }))
    expect(routerMock.back).toHaveBeenCalledOnce()
  })

  it('asks before discarding an unsaved draft', async () => {
    const user = userEvent.setup()
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
    expect(routerMock.back).toHaveBeenCalledOnce()
  })

  it('warns before leaving a partially created knowledge space', async () => {
    const user = userEvent.setup()
    serviceMock.patchPolicy.mockRejectedValueOnce(new Error('policy update unavailable'))
    renderPage()
    await fillRequiredFields(user)

    await user.click(screen.getByRole('button', { name: 'dataset.newKnowledge.createTitle' }))
    expect(
      await screen.findByText('dataset.newKnowledge.permissionUpdateFailed'),
    ).toBeInTheDocument()

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
