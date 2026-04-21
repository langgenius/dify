import type { ReactNode } from 'react'
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

vi.mock('@/app/components/base/input', () => ({
  default: ({
    value,
    onChange,
    placeholder,
    className,
  }: {
    value?: string
    onChange: (event: { target: { value: string } }) => void
    placeholder?: string
    className?: string
  }) => (
    <input
      className={className}
      placeholder={placeholder}
      value={value}
      onChange={e => onChange({ target: { value: e.target.value } })}
    />
  ),
}))

vi.mock('@langgenius/dify-ui/popover', async () => {
  const React = await import('react')
  const PopoverContext = React.createContext({
    open: false,
    setOpen: (_open: boolean) => {},
  })

  const Popover = ({
    children,
    open: controlledOpen,
    onOpenChange,
  }: {
    children: ReactNode
    open?: boolean
    onOpenChange?: (open: boolean) => void
  }) => {
    const [uncontrolledOpen, setUncontrolledOpen] = React.useState(false)
    const isControlled = controlledOpen !== undefined
    const open = isControlled ? !!controlledOpen : uncontrolledOpen
    const setOpen = (nextOpen: boolean) => {
      if (!isControlled)
        setUncontrolledOpen(nextOpen)
      onOpenChange?.(nextOpen)
    }

    return (
      <PopoverContext.Provider value={{ open, setOpen }}>
        {children}
      </PopoverContext.Provider>
    )
  }

  const PopoverTrigger = ({ render }: { render: ReactNode }) => <>{render}</>

  const PopoverContent = ({ children }: { children: ReactNode }) => {
    const { open } = React.useContext(PopoverContext)
    return open ? <div data-testid="education-search-popover">{children}</div> : null
  }

  return {
    Popover,
    PopoverTrigger,
    PopoverContent,
  }
})

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

  it('opens the popover, queries schools, and closes after selection', async () => {
    const user = userEvent.setup()

    render(<ControlledSearchInput />)

    const input = screen.getByPlaceholderText('form.schoolName.placeholder')
    await user.type(input, 'A')

    expect(educationMocks.setSchools).toHaveBeenCalledWith([])
    expect(educationMocks.querySchoolsWithDebounced).toHaveBeenLastCalledWith({
      keywords: 'A',
      page: 0,
    })

    expect(screen.getByTestId('education-search-popover')).toBeInTheDocument()
    expect(screen.getByText('Alpha University')).toBeInTheDocument()

    await user.click(screen.getByText('Beta College'))

    expect(screen.getByDisplayValue('Beta College')).toBeInTheDocument()
    expect(screen.queryByTestId('education-search-popover')).not.toBeInTheDocument()
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
