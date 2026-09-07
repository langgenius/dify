import { act, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { useState } from 'react'
import InstitutionField from '../institution-field'

const educationAutocompleteQueryMock = vi.hoisted(() => ({
  options: vi.fn(),
  fetchNextPage: vi.fn(),
  hasNextPage: false,
  isError: false,
  isFetching: false,
  data: {
    pages: [
      {
        curr_page: 0,
        data: ['Alpha University', 'Beta College'],
        has_next: false,
      },
    ],
  },
}))

const debouncedValueMock = vi.hoisted(() => ({
  hold: false,
  value: '',
}))

const keepPreviousDataMock = vi.hoisted(() => vi.fn((previousData: unknown) => previousData))

vi.mock('@tanstack/react-query', () => ({
  keepPreviousData: keepPreviousDataMock,
  useInfiniteQuery: (options: unknown) => {
    educationAutocompleteQueryMock.options(options)
    return educationAutocompleteQueryMock
  },
}))

vi.mock('@/service/client', () => ({
  consoleQuery: {
    account: {
      education: {
        autocomplete: {
          get: {
            infiniteOptions: (options: unknown) => options,
          },
        },
      },
    },
  },
}))

vi.mock('foxact/use-debounced-value', () => ({
  useDebouncedValue: <T,>(value: T) =>
    debouncedValueMock.hold ? (debouncedValueMock.value as T) : value,
}))

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
    educationAutocompleteQueryMock.hasNextPage = false
    educationAutocompleteQueryMock.isError = false
    educationAutocompleteQueryMock.isFetching = false
    educationAutocompleteQueryMock.data.pages[0]!.data = ['Alpha University', 'Beta College']
    debouncedValueMock.hold = false
    debouncedValueMock.value = ''
  })

  afterEach(() => {
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
      const options = educationAutocompleteQueryMock.options.mock.lastCall?.[0] as {
        enabled: boolean
        input: (page: number) => unknown
      }
      expect(options.enabled).toBe(true)
      expect(options.input(0)).toEqual({
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
    educationAutocompleteQueryMock.data.pages[0]!.data = []

    render(<ControlledInstitutionField />)

    const input = screen.getByPlaceholderText(/(?:^|\.)form\.schoolName\.placeholder(?=$|:)/)
    await user.type(input, 'Dify Academy')

    expect(await screen.findByText('education.form.schoolName.noResults')).toBeInTheDocument()
    expect(input).toHaveValue('Dify Academy')
  })

  it('keeps previous suggestions open while a new search settles', async () => {
    const user = userEvent.setup()
    const view = render(<ControlledInstitutionField />)
    const input = screen.getByPlaceholderText(/(?:^|\.)form\.schoolName\.placeholder(?=$|:)/)

    await user.type(input, 'A')
    expect(await screen.findByText('Alpha University')).toBeInTheDocument()

    debouncedValueMock.hold = true
    debouncedValueMock.value = 'A'
    await user.type(input, 'l')

    expect(input).toHaveAttribute('aria-expanded', 'true')
    expect(screen.getByText('Alpha University')).toBeInTheDocument()

    debouncedValueMock.hold = false
    educationAutocompleteQueryMock.isFetching = true
    view.rerender(<ControlledInstitutionField />)

    expect(input).toHaveAttribute('aria-expanded', 'true')
    expect(screen.getByText('Alpha University')).toBeInTheDocument()
    expect(educationAutocompleteQueryMock.options.mock.lastCall?.[0]).toMatchObject({
      placeholderData: keepPreviousDataMock,
    })

    educationAutocompleteQueryMock.data.pages[0]!.data = ['Alpine University']
    educationAutocompleteQueryMock.isFetching = false
    view.rerender(<ControlledInstitutionField />)

    expect(screen.getByText('Alpine University')).toBeInTheDocument()
    expect(screen.queryByText('Alpha University')).not.toBeInTheDocument()
  })

  it('requests the next page when the suggestions sentinel enters the preload area', async () => {
    const user = userEvent.setup()
    const triggerIntersection = stubIntersectionObserver()
    educationAutocompleteQueryMock.hasNextPage = true

    render(<ControlledInstitutionField />)

    await user.type(
      screen.getByPlaceholderText(/(?:^|\.)form\.schoolName\.placeholder(?=$|:)/),
      'A',
    )

    await screen.findByRole('listbox')
    await triggerIntersection()

    expect(educationAutocompleteQueryMock.fetchNextPage).toHaveBeenCalledOnce()
    expect(educationAutocompleteQueryMock.fetchNextPage).toHaveBeenCalledWith({
      cancelRefetch: false,
    })
  })

  it('keeps keyboard navigation at the loaded list boundary', async () => {
    const user = userEvent.setup()
    educationAutocompleteQueryMock.hasNextPage = true

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
    educationAutocompleteQueryMock.hasNextPage = true
    educationAutocompleteQueryMock.isError = true

    render(<ControlledInstitutionField />)

    await user.type(
      screen.getByPlaceholderText(/(?:^|\.)form\.schoolName\.placeholder(?=$|:)/),
      'A',
    )

    expect(await screen.findByText('Alpha University')).toBeInTheDocument()
    expect(
      screen
        .getAllByText('common.dynamicSelect.error')
        .some((element) => element.closest('[role="status"]') !== null),
    ).toBe(true)
  })
})
