import { fireEvent, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { useState } from 'react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import SearchInput from '../search-input'

const educationMocks = vi.hoisted(() => ({
  schools: ['Alpha University', 'Beta College'],
  setSchools: vi.fn(),
  querySchoolsWithDebounced: vi.fn(),
  handleUpdateSchools: vi.fn(),
  hasNext: false,
}))

vi.mock('../hooks', () => ({
  useEducation: () => educationMocks,
}))

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string) => key,
  }),
}))

const ControlledSearchInput = () => {
  const [value, setValue] = useState('')
  return <SearchInput value={value} onChange={setValue} />
}

describe('education-apply/search-input', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    educationMocks.schools = ['Alpha University', 'Beta College']
    educationMocks.hasNext = false
  })

  it('keeps the search field editable when used as the popover trigger', async () => {
    const user = userEvent.setup()
    educationMocks.schools = []

    render(<ControlledSearchInput />)

    const input = screen.getByPlaceholderText('form.schoolName.placeholder') as HTMLInputElement
    expect(input.type).toBe('text')

    await user.type(input, 'Alpha')

    expect(input).toHaveValue('Alpha')
    expect(educationMocks.setSchools).toHaveBeenCalledWith([])
    expect(educationMocks.querySchoolsWithDebounced).toHaveBeenLastCalledWith({
      keywords: 'Alpha',
      page: 0,
    })
  })

  it('closes the popover after selecting a school', async () => {
    const user = userEvent.setup()

    render(<ControlledSearchInput />)

    await user.type(screen.getByPlaceholderText('form.schoolName.placeholder'), 'A')

    expect(screen.getByText('Alpha University')).toBeInTheDocument()

    await user.click(screen.getByText('Beta College'))

    expect(screen.getByDisplayValue('Beta College')).toBeInTheDocument()
    expect(screen.queryByText('Alpha University')).not.toBeInTheDocument()
  })

  it('loads the next page when the dropdown is scrolled to the bottom', async () => {
    const user = userEvent.setup()
    educationMocks.hasNext = true

    render(<ControlledSearchInput />)

    await user.type(screen.getByPlaceholderText('form.schoolName.placeholder'), 'A')

    const scrollContainer = screen.getByText('Alpha University').parentElement as HTMLDivElement
    Object.defineProperties(scrollContainer, {
      scrollTop: {
        value: 60,
        configurable: true,
      },
      scrollHeight: {
        value: 100,
        configurable: true,
      },
      clientHeight: {
        value: 40,
        configurable: true,
      },
    })

    fireEvent.scroll(scrollContainer)

    expect(educationMocks.handleUpdateSchools).toHaveBeenCalledWith({
      keywords: 'A',
      page: 1,
    })
  })
})
