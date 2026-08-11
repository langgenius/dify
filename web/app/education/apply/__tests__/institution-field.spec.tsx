import { fireEvent, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { useState } from 'react'
import InstitutionField from '../institution-field'

const institutionSuggestionMocks = vi.hoisted(() => ({
  suggestions: ['Alpha University', 'Beta College'],
  clearSuggestions: vi.fn(),
  requestSuggestions: vi.fn(),
  requestSuggestionsDebounced: vi.fn(),
  hasNextPage: false,
  isPending: false,
}))

vi.mock('../use-institution-suggestions', () => ({
  useInstitutionSuggestions: () => institutionSuggestionMocks,
}))

const ControlledInstitutionField = () => {
  const [value, setValue] = useState('')
  return <InstitutionField value={value} onValueChange={setValue} />
}

describe('InstitutionField', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    institutionSuggestionMocks.suggestions = ['Alpha University', 'Beta College']
    institutionSuggestionMocks.hasNextPage = false
    institutionSuggestionMocks.isPending = false
  })

  it('accepts free-form institution names and requests suggestions', async () => {
    const user = userEvent.setup()
    institutionSuggestionMocks.suggestions = []

    render(<ControlledInstitutionField />)

    const input = screen.getByPlaceholderText(
      /(?:^|\.)form\.schoolName\.placeholder(?=$|:)/,
    ) as HTMLInputElement
    expect(input.type).toBe('text')
    expect(input).toHaveAccessibleName('education.form.schoolName.title')

    await user.type(input, 'Alpha')

    expect(input).toHaveValue('Alpha')
    expect(institutionSuggestionMocks.clearSuggestions).toHaveBeenCalled()
    expect(institutionSuggestionMocks.requestSuggestionsDebounced).toHaveBeenLastCalledWith({
      query: 'Alpha',
      page: 0,
    })
  })

  it('closes the suggestions after selecting an institution', async () => {
    const user = userEvent.setup()

    render(<ControlledInstitutionField />)

    await user.type(
      screen.getByPlaceholderText(/(?:^|\.)form\.schoolName\.placeholder(?=$|:)/),
      'A',
    )

    expect(screen.getByText('Alpha University')).toBeInTheDocument()

    await user.click(screen.getByRole('option', { name: 'Beta College' }))

    expect(screen.getByRole('combobox')).toHaveValue('Beta College')
    expect(screen.queryByText('Alpha University')).not.toBeInTheDocument()
  })

  it('requests the next page when the suggestions reach the scroll boundary', async () => {
    const user = userEvent.setup()
    institutionSuggestionMocks.hasNextPage = true

    render(<ControlledInstitutionField />)

    await user.type(
      screen.getByPlaceholderText(/(?:^|\.)form\.schoolName\.placeholder(?=$|:)/),
      'A',
    )

    const scrollContainer = screen.getByRole('listbox')
    Object.defineProperties(scrollContainer, {
      scrollTop: { value: 60, configurable: true },
      scrollHeight: { value: 100, configurable: true },
      clientHeight: { value: 40, configurable: true },
    })

    fireEvent.scroll(scrollContainer)

    expect(institutionSuggestionMocks.requestSuggestions).toHaveBeenCalledWith({
      query: 'A',
      page: 1,
    })
  })
})
