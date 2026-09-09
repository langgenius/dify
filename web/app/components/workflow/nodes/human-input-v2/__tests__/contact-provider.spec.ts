import type {
  BatchGetContactOptionsResponse,
  ListContactOptionsResponse,
} from '@dify/contracts/api/console/workspaces/types.gen'
import { QueryClient } from '@tanstack/react-query'
import {
  createContactRecipientOptionProvider,
  mockContactRecipientOptionProvider,
} from '../contact-provider'

const api = vi.hoisted(() => ({
  search:
    vi.fn<
      (input: {
        query: { keyword: string; page: number; limit: number }
      }) => Promise<ListContactOptionsResponse>
    >(),
  resolve:
    vi.fn<
      (input: { query: { contact_ids: string[] } }) => Promise<BatchGetContactOptionsResponse>
    >(),
}))

vi.mock('@/service/client', async () => {
  const { createTanstackQueryUtils } = await import('@orpc/tanstack-query')
  return {
    consoleQuery: createTanstackQueryUtils({
      workspaces: {
        current: {
          humanInput: { contactOptions: { get: api.search, batch: { get: api.resolve } } },
        },
      },
    }),
  }
})

const firstPage: ListContactOptionsResponse = {
  data: [
    { id: 'contact-1', name: 'First contact', email: null, avatar_url: null, type: 'platform' },
  ],
  page: 1,
  limit: 20,
  total: 21,
}

describe('Contact recipient API provider', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('searches the editor-safe endpoint and preserves server pagination', async () => {
    api.search.mockResolvedValueOnce(firstPage).mockResolvedValueOnce({
      ...firstPage,
      data: [
        { id: 'contact-21', name: 'Last contact', email: 'last@example.com', type: 'external' },
      ],
      page: 2,
    })
    const provider = createContactRecipientOptionProvider('workspace-1', new QueryClient())

    await expect(provider.searchPage?.(' contact ', 1)).resolves.toEqual({
      data: [
        {
          id: 'contact-1',
          name: 'First contact',
          email: '',
          avatar: undefined,
          source: 'organization',
        },
      ],
      page: 1,
      hasMore: true,
    })
    await expect(provider.searchPage?.(' contact ', 2)).resolves.toMatchObject({
      data: [{ id: 'contact-21' }],
      page: 2,
      hasMore: false,
    })
    expect(api.search.mock.calls.map(([input]) => input)).toEqual([
      { query: { keyword: 'contact', limit: 20, page: 1 } },
      { query: { keyword: 'contact', limit: 20, page: 2 } },
    ])
  })

  it('resolves saved IDs through the editor-safe batch endpoint and omits missing contacts', async () => {
    api.resolve.mockResolvedValue({ data: firstPage.data })
    const provider = createContactRecipientOptionProvider('workspace-1', new QueryClient())

    await expect(
      provider.resolve({ contact_ids: ['missing', 'contact-1', 'contact-1'] }),
    ).resolves.toMatchObject([{ id: 'contact-1', name: 'First contact' }])
    expect(api.resolve.mock.calls[0]?.[0]).toEqual({
      query: { contact_ids: ['contact-1', 'missing'] },
    })
    await expect(provider.resolve({ contact_ids: [] })).resolves.toEqual([])
    expect(api.resolve).toHaveBeenCalledOnce()
  })

  it('does not share in-flight searches across workspaces', async () => {
    let finishFirst: (response: ListContactOptionsResponse) => void = () => undefined
    api.search
      .mockImplementationOnce(
        () =>
          new Promise((resolve) => {
            finishFirst = resolve
          }),
      )
      .mockResolvedValueOnce({
        ...firstPage,
        data: [{ ...firstPage.data[0]!, id: 'workspace-2-contact' }],
      })
    const queryClient = new QueryClient()
    const first = createContactRecipientOptionProvider('workspace-1', queryClient).search('')
    const second = createContactRecipientOptionProvider('workspace-2', queryClient).search('')

    await expect(second).resolves.toMatchObject([{ id: 'workspace-2-contact' }])
    finishFirst(firstPage)
    await expect(first).resolves.toMatchObject([{ id: 'contact-1' }])
    expect(api.search).toHaveBeenCalledTimes(2)
  })

  it('refreshes search results after another screen creates a contact', async () => {
    api.search
      .mockResolvedValueOnce({ ...firstPage, data: [], total: 0 })
      .mockResolvedValueOnce(firstPage)
    const provider = createContactRecipientOptionProvider('workspace-1', new QueryClient())

    await expect(provider.search('First')).resolves.toEqual([])
    await expect(provider.search('First')).resolves.toMatchObject([{ id: 'contact-1' }])
  })
})

describe('mock Contact recipient option provider', () => {
  it('provides deterministic case-insensitive search and id resolution', async () => {
    await expect(mockContactRecipientOptionProvider.search('EVAN')).resolves.toEqual([
      expect.objectContaining({ id: 'contact-evan', name: 'Evan Zhang' }),
    ])
    await expect(
      mockContactRecipientOptionProvider.resolve({
        contact_ids: ['missing', 'contact-amanda'],
      }),
    ).resolves.toEqual([expect.objectContaining({ id: 'contact-amanda' })])
  })

  it('returns defensive copies', async () => {
    const first = await mockContactRecipientOptionProvider.search('')
    first[0]!.name = 'Changed'
    const second = await mockContactRecipientOptionProvider.search('')

    expect(second[0]!.name).toBe('Evan Zhang')
  })
})
