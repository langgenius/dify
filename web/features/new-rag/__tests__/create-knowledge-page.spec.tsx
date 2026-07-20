import type { ReactNode } from 'react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { render, screen, waitFor } from '@testing-library/react'
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

vi.mock('@/next/navigation', () => ({
  useRouter: () => routerMock,
}))

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
    screen.getByRole('textbox', { name: 'dataset.newKnowledge.description' }),
    '  Internal answers  ',
  )
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
    await user.click(screen.getByRole('button', { name: 'common.operation.create' }))

    expect(serviceMock.create).not.toHaveBeenCalled()
    expect(screen.getByText('dataset.newKnowledge.nameRequired')).toBeInTheDocument()
  })

  it('creates a private empty knowledge space, invalidates the list, and navigates', async () => {
    const user = userEvent.setup()
    const queryClient = new QueryClient({ defaultOptions: { mutations: { retry: false } } })
    const invalidate = vi.spyOn(queryClient, 'invalidateQueries')
    renderPage(queryClient)
    await fillRequiredFields(user)

    await user.click(screen.getByRole('button', { name: 'common.operation.create' }))

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

  it('updates the revisioned access policy when all members is selected', async () => {
    const user = userEvent.setup()
    renderPage()
    await fillRequiredFields(user)
    await user.selectOptions(
      screen.getByRole('combobox', { name: 'dataset.newKnowledge.permission' }),
      'all_members',
    )

    await user.click(screen.getByRole('button', { name: 'common.operation.create' }))

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
    const createButton = screen.getByRole('button', { name: 'common.operation.create' })

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

    await user.click(screen.getByRole('button', { name: 'common.operation.create' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('dataset.newKnowledge.createFailed')
    await user.click(screen.getByRole('button', { name: 'common.operation.create' }))

    await waitFor(() => expect(serviceMock.create).toHaveBeenCalledTimes(2))
    expect(serviceMock.create.mock.calls[0]?.[0].body.idempotencyKey).toBe(
      serviceMock.create.mock.calls[1]?.[0].body.idempotencyKey,
    )
  })

  it('safely resumes the permission step after a partial failure', async () => {
    const user = userEvent.setup()
    serviceMock.patchPolicy.mockRejectedValueOnce(new Error('policy update unavailable'))
    renderPage()
    await fillRequiredFields(user)
    await user.selectOptions(
      screen.getByRole('combobox', { name: 'dataset.newKnowledge.permission' }),
      'all_members',
    )

    await user.click(screen.getByRole('button', { name: 'common.operation.create' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('dataset.newKnowledge.createFailed')
    await user.click(screen.getByRole('button', { name: 'common.operation.create' }))

    await waitFor(() => expect(serviceMock.patchPolicy).toHaveBeenCalledTimes(2))
    expect(serviceMock.create.mock.calls[0]?.[0].body.idempotencyKey).toBe(
      serviceMock.create.mock.calls[1]?.[0].body.idempotencyKey,
    )
    expect(routerMock.replace).toHaveBeenCalledWith(
      '/datasets/new/e735c1dc-d2b8-4dc4-86dc-abaf2fb7d084/sources',
    )
  })

  it('keeps unavailable source modes disabled instead of simulating success', () => {
    renderPage()

    expect(screen.getByRole('button', { name: 'dataset.newKnowledge.startEmpty' })).toBeEnabled()
    expect(
      screen.getByRole('button', { name: 'dataset.newKnowledge.connectSource' }),
    ).toBeDisabled()
    expect(screen.getByRole('button', { name: 'dataset.newKnowledge.uploadFiles' })).toBeDisabled()
  })
})
