import { fireEvent, render, screen, within } from '@testing-library/react'
import CreatorsFilter from '../creators-filter'

const mockOnChange = vi.hoisted(() => vi.fn())

vi.mock('@/context/account-state', async (importOriginal) => {
  const { createAppContextStateAtomMock } = await import('@/__tests__/utils/mock-app-context-state')

  return createAppContextStateAtomMock(importOriginal, () => ({
    userProfile: { id: 'member-2' },
  }))
})
vi.mock('@/context/workspace-state', async (importOriginal) => {
  const { createAppContextStateAtomMock } = await import('@/__tests__/utils/mock-app-context-state')

  return createAppContextStateAtomMock(importOriginal, () => ({
    userProfile: { id: 'member-2' },
  }))
})
vi.mock('@/context/permission-state', async (importOriginal) => {
  const { createAppContextStateAtomMock } = await import('@/__tests__/utils/mock-app-context-state')

  return createAppContextStateAtomMock(importOriginal, () => ({
    userProfile: { id: 'member-2' },
  }))
})
vi.mock('@/context/version-state', async (importOriginal) => {
  const { createAppContextStateAtomMock } = await import('@/__tests__/utils/mock-app-context-state')

  return createAppContextStateAtomMock(importOriginal, () => ({
    userProfile: { id: 'member-2' },
  }))
})
vi.mock('@/context/system-features-state', async (importOriginal) => {
  const { createAppContextStateAtomMock } = await import('@/__tests__/utils/mock-app-context-state')

  return createAppContextStateAtomMock(importOriginal, () => ({
    userProfile: { id: 'member-2' },
  }))
})

vi.mock('jotai', async (importOriginal) => {
  const { createAppContextStateJotaiMock } =
    await import('@/__tests__/utils/mock-app-context-state')

  return createAppContextStateJotaiMock(importOriginal)
})

vi.mock('@/service/use-common', () => ({
  useMembers: () => ({
    data: {
      accounts: [
        { id: 'member-1', name: 'Zoe', avatar_url: null, status: 'active' },
        { id: 'member-2', name: 'Alice', avatar_url: null, status: 'active' },
        { id: 'member-3', name: 'Bob', avatar_url: null, status: 'active' },
        { id: 'member-4', name: 'Pending User', avatar_url: null, status: 'pending' },
      ],
    },
  }),
}))

describe('CreatorsFilter', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('should sort the current user first and filter out pending members', () => {
    render(<CreatorsFilter value={[]} onChange={mockOnChange} />)

    fireEvent.click(screen.getByRole('button', { name: /app\.studio\.filters\.creators/i }))

    const options = screen
      .getAllByRole('button')
      .filter((button) =>
        ['Alice', 'Bob', 'Zoe'].some((name) => button.textContent?.includes(name)),
      )

    expect(options.map((option) => option.textContent)).toEqual([
      expect.stringContaining('Alice'),
      expect.stringContaining('Bob'),
      expect.stringContaining('Zoe'),
    ])
    expect(screen.getByText('app.studio.filters.you')).toBeInTheDocument()
    expect(screen.queryByText('Pending User')).not.toBeInTheDocument()
  })

  it('should search creators, clear keywords, and select a creator', () => {
    render(<CreatorsFilter value={[]} onChange={mockOnChange} />)

    fireEvent.click(screen.getByRole('button', { name: /app\.studio\.filters\.creators/i }))
    fireEvent.change(screen.getByPlaceholderText('app.studio.filters.searchCreators'), {
      target: { value: 'zo' },
    })

    expect(screen.getByRole('button', { name: /Zoe/ })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /Bob/ })).not.toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: 'common.operation.clear' }))

    expect(screen.getByPlaceholderText('app.studio.filters.searchCreators')).toHaveValue('')

    fireEvent.click(screen.getByRole('button', { name: /Bob/ }))

    expect(mockOnChange).toHaveBeenCalledWith(['member-3'])
  })

  it('should remove selected creators from the trigger reset and menu reset controls', () => {
    const { rerender } = render(
      <CreatorsFilter value={['member-2', 'member-3']} onChange={mockOnChange} />,
    )

    const trigger = screen.getByRole('button', { name: /app\.studio\.filters\.creators/i })
    fireEvent.click(within(trigger).getByRole('button', { name: 'app.studio.filters.reset' }))

    expect(mockOnChange).toHaveBeenCalledWith([])

    rerender(<CreatorsFilter value={['member-2', 'member-3']} onChange={mockOnChange} />)

    fireEvent.click(screen.getByRole('button', { name: /app\.studio\.filters\.creators/i }))
    fireEvent.click(screen.getAllByRole('button', { name: 'app.studio.filters.reset' }).at(-1)!)

    expect(mockOnChange).toHaveBeenCalledWith([])
  })

  it('should remove a selected creator when toggled from the menu', () => {
    render(<CreatorsFilter value={['member-2', 'member-3']} onChange={mockOnChange} />)

    fireEvent.click(screen.getByRole('button', { name: /app\.studio\.filters\.creators/i }))
    fireEvent.click(screen.getByRole('button', { name: /Alice/ }))

    expect(mockOnChange).toHaveBeenCalledWith(['member-3'])
  })
})
