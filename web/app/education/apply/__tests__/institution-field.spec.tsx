import type { QueryClient } from '@tanstack/react-query'
import type { ReactElement } from 'react'
import { act, render as RTLRender, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { useState } from 'react'
import { createQueryClientWrapper } from '@/test/console/query-client'
import { createTestQueryClient } from '@/test/query-client'
import InstitutionField from '../institution-field'

const mockAutocomplete = vi.hoisted(() => vi.fn())

vi.mock('@/service/console', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/service/console')>()
  const operation = actual.consoleQuery.account.education.autocomplete.get
  return {
    consoleQuery: {
      account: {
        education: {
          autocomplete: {
            get: {
              infiniteOptions: (...args: Parameters<typeof operation.infiniteOptions>) => ({
                ...operation.infiniteOptions(...args),
                queryFn: ({ pageParam }: { pageParam: unknown }) => {
                  const input = args[0].input
                  return mockAutocomplete(typeof input === 'function' ? input(pageParam) : input)
                },
              }),
            },
          },
        },
      },
    },
  }
})

let queryClient: QueryClient
const render = (ui: ReactElement) =>
  RTLRender(ui, { wrapper: createQueryClientWrapper(queryClient) })

const ControlledInstitutionField = () => {
  const [value, setValue] = useState('')
  return <InstitutionField value={value} onValueChange={setValue} />
}

function stubIntersectionObserver() {
  let callback: IntersectionObserverCallback | undefined

  vi.stubGlobal(
    'IntersectionObserver',
    class MockIntersectionObserver {
      constructor(nextCallback: IntersectionObserverCallback) {
        callback = nextCallback
      }

      observe() {}
      unobserve() {}
      disconnect() {}
    },
  )

  return async () => {
    await waitFor(() => {
      expect(callback).toBeDefined()
    })
    act(() => {
      callback?.(
        [{ isIntersecting: true } as IntersectionObserverEntry],
        {} as IntersectionObserver,
      )
    })
  }
}

describe('InstitutionField', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    queryClient = createTestQueryClient()
    mockAutocomplete.mockReset().mockResolvedValue({
      curr_page: 0,
      data: ['Alpha University', 'Beta College'],
      has_next: false,
    })
  })

  afterEach(() => {
    queryClient.clear()
    vi.unstubAllGlobals()
  })

  it('uses a free-form institution name as the suggestions query', async () => {
    const user = userEvent.setup()
    render(<ControlledInstitutionField />)

    const input = screen.getByPlaceholderText(
      /(?:^|\.)form\.schoolName\.placeholder(?=$|:)/,
    ) as HTMLInputElement
    expect(input.type).toBe('text')
    expect(input).toHaveAccessibleName('education.form.schoolName.title')

    await user.type(input, 'Alpha')

    expect(input).toHaveValue('Alpha')
    await waitFor(() => {
      expect(mockAutocomplete).toHaveBeenCalledWith({
        query: { keywords: 'Alpha', limit: 40, page: 0 },
      })
    })
  })

  it('closes the suggestions without showing the empty state after keyboard selection', async () => {
    const user = userEvent.setup()

    render(<ControlledInstitutionField />)

    const input = screen.getByPlaceholderText(/(?:^|\.)form\.schoolName\.placeholder(?=$|:)/)
    await user.type(input, 'A')

    expect(await screen.findByText('Alpha University')).toBeInTheDocument()

    await user.keyboard('{ArrowDown}{Enter}')

    expect(input).toHaveValue('Alpha University')
    expect(screen.queryByText('education.form.schoolName.noResults')).not.toBeInTheDocument()
  })

  it('keeps an unmatched institution name as free-form input', async () => {
    const user = userEvent.setup()
    mockAutocomplete.mockResolvedValue({ curr_page: 0, data: [], has_next: false })

    render(<ControlledInstitutionField />)

    const input = screen.getByPlaceholderText(/(?:^|\.)form\.schoolName\.placeholder(?=$|:)/)
    await user.type(input, 'Dify Academy')

    expect(await screen.findByText('education.form.schoolName.noResults')).toBeInTheDocument()
    expect(input).toHaveValue('Dify Academy')
  })

  it('keeps previous suggestions open while a new search settles', async () => {
    const user = userEvent.setup()
    render(<ControlledInstitutionField />)
    const input = screen.getByPlaceholderText(/(?:^|\.)form\.schoolName\.placeholder(?=$|:)/)

    await user.type(input, 'A')
    expect(await screen.findByText('Alpha University')).toBeInTheDocument()

    let resolveSearch!: (value: { curr_page: number; data: string[]; has_next: boolean }) => void
    mockAutocomplete.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          resolveSearch = resolve
        }),
    )
    await user.type(input, 'l')

    expect(input).toHaveAttribute('aria-expanded', 'true')
    expect(screen.getByText('Alpha University')).toBeInTheDocument()

    await waitFor(() =>
      expect(mockAutocomplete).toHaveBeenLastCalledWith({
        query: { keywords: 'Al', limit: 40, page: 0 },
      }),
    )
    expect(input).toHaveAttribute('aria-expanded', 'true')
    expect(screen.getByText('Alpha University')).toBeInTheDocument()
    expect(screen.queryByText('education.form.schoolName.noResults')).not.toBeInTheDocument()

    await act(async () => {
      resolveSearch({ curr_page: 0, data: ['Alpine University'], has_next: false })
    })
    await screen.findByText('Alpine University')

    expect(screen.getByText('Alpine University')).toBeInTheDocument()
    expect(screen.queryByText('Alpha University')).not.toBeInTheDocument()
  })

  it('requests the next page when the suggestions sentinel enters the preload area', async () => {
    const user = userEvent.setup()
    const triggerIntersection = stubIntersectionObserver()
    mockAutocomplete.mockResolvedValueOnce({
      curr_page: 0,
      data: ['Alpha University', 'Beta College'],
      has_next: true,
    })

    render(<ControlledInstitutionField />)

    await user.type(
      screen.getByPlaceholderText(/(?:^|\.)form\.schoolName\.placeholder(?=$|:)/),
      'A',
    )

    await screen.findByText('Alpha University')
    mockAutocomplete.mockResolvedValueOnce({
      curr_page: 1,
      data: ['Gamma College'],
      has_next: false,
    })
    await triggerIntersection()

    expect(await screen.findByText('Gamma College')).toBeInTheDocument()
    expect(screen.getByText('Alpha University')).toBeInTheDocument()
    expect(mockAutocomplete).toHaveBeenLastCalledWith({
      query: { keywords: 'A', limit: 40, page: 1 },
    })
  })

  it('keeps keyboard navigation at the loaded list boundary', async () => {
    const user = userEvent.setup()
    mockAutocomplete.mockResolvedValueOnce({
      curr_page: 0,
      data: ['Alpha University', 'Beta College'],
      has_next: true,
    })

    render(<ControlledInstitutionField />)

    await user.type(
      screen.getByPlaceholderText(/(?:^|\.)form\.schoolName\.placeholder(?=$|:)/),
      'A',
    )
    await screen.findByText('Beta College')
    await user.keyboard('{ArrowDown}{ArrowDown}{ArrowDown}')

    expect(screen.getByText('Beta College').closest('[role="option"]')).toHaveAttribute(
      'data-highlighted',
    )
  })

  it('keeps loaded suggestions visible when the next page fails', async () => {
    const user = userEvent.setup()
    mockAutocomplete.mockResolvedValueOnce({
      curr_page: 0,
      data: ['Alpha University', 'Beta College'],
      has_next: true,
    })
    const triggerIntersection = stubIntersectionObserver()
    mockAutocomplete.mockRejectedValueOnce(new Error('Pagination failed'))

    render(<ControlledInstitutionField />)

    await user.type(
      screen.getByPlaceholderText(/(?:^|\.)form\.schoolName\.placeholder(?=$|:)/),
      'A',
    )

    expect(await screen.findByText('Alpha University')).toBeInTheDocument()
    await triggerIntersection()
    await screen.findAllByText('common.dynamicSelect.error')
    expect(screen.getByText('Alpha University')).toBeInTheDocument()
    expect(
      screen
        .getAllByText('common.dynamicSelect.error')
        .some((element) => element.closest('[role="status"]') !== null),
    ).toBe(true)
  })
})
