import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { useState } from 'react'
import InstitutionField from '../institution-field'

const educationAutocompleteQueryMock = vi.hoisted(() => ({
  options: vi.fn(),
  fetchNextPage: vi.fn(),
  hasNextPage: false,
  isFetchingNextPage: false,
  isPending: false,
  isSuccess: true,
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

vi.mock('@tanstack/react-query', () => ({
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
  useDebouncedValue: <T,>(value: T) => value,
}))

const ControlledInstitutionField = () => {
  const [value, setValue] = useState('')
  return <InstitutionField value={value} onValueChange={setValue} />
}

describe('InstitutionField', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    educationAutocompleteQueryMock.hasNextPage = false
    educationAutocompleteQueryMock.isFetchingNextPage = false
    educationAutocompleteQueryMock.isPending = false
    educationAutocompleteQueryMock.isSuccess = true
    educationAutocompleteQueryMock.data.pages[0]!.data = ['Alpha University', 'Beta College']
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

  it('requests the next page when the suggestions reach the scroll boundary', async () => {
    const user = userEvent.setup()
    educationAutocompleteQueryMock.hasNextPage = true

    render(<ControlledInstitutionField />)

    await user.type(
      screen.getByPlaceholderText(/(?:^|\.)form\.schoolName\.placeholder(?=$|:)/),
      'A',
    )

    const scrollContainer = await screen.findByRole('listbox')
    Object.defineProperties(scrollContainer, {
      scrollTop: { value: 60, configurable: true },
      scrollHeight: { value: 100, configurable: true },
      clientHeight: { value: 40, configurable: true },
    })

    fireEvent.scroll(scrollContainer)

    expect(educationAutocompleteQueryMock.fetchNextPage).toHaveBeenCalledTimes(1)
  })
})
