import { render, screen } from '@testing-library/react'
import { ChunkingMode } from '@/models/datasets'
import ChunkStructure from './index'

type MockOptionCardProps = {
  id: string
  title: string
  isActive?: boolean
  disabled?: boolean
}

// Mock dependencies
vi.mock('../option-card', () => ({
  default: ({ id, title, isActive, disabled }: MockOptionCardProps) => (
    <div
      data-testid="option-card"
      data-id={id}
      data-active={isActive}
      data-disabled={disabled}
    >
      {title}
    </div>
  ),
}))

// Mock hook
vi.mock('./hooks', () => ({
  useChunkStructure: () => ({
    options: [
      {
        id: ChunkingMode.text,
        title: 'General',
        description: 'General description',
        icon: <svg />,
        effectColor: 'indigo',
        iconActiveColor: 'indigo',
      },
      {
        id: ChunkingMode.parentChild,
        title: 'Parent-Child',
        description: 'PC description',
        icon: <svg />,
        effectColor: 'blue',
        iconActiveColor: 'blue',
      },
    ],
  }),
}))

describe('ChunkStructure', () => {
  it('should render all options', () => {
    render(<ChunkStructure chunkStructure={ChunkingMode.text} />)

    const options = screen.getAllByTestId('option-card')
    expect(options).toHaveLength(2)
    expect(options[0]).toHaveTextContent('General')
    expect(options[1]).toHaveTextContent('Parent-Child')
  })

  it('should set active state correctly', () => {
    // Render with 'text' active
    const { unmount } = render(<ChunkStructure chunkStructure={ChunkingMode.text} />)

    const options = screen.getAllByTestId('option-card')
    expect(options[0]).toHaveAttribute('data-active', 'true')
    expect(options[1]).toHaveAttribute('data-active', 'false')

    unmount()

    // Render with 'parentChild' active
    render(<ChunkStructure chunkStructure={ChunkingMode.parentChild} />)
    const newOptions = screen.getAllByTestId('option-card')
    expect(newOptions[0]).toHaveAttribute('data-active', 'false')
    expect(newOptions[1]).toHaveAttribute('data-active', 'true')
  })

  it('should be always disabled', () => {
    render(<ChunkStructure chunkStructure={ChunkingMode.text} />)

    const options = screen.getAllByTestId('option-card')
    options.forEach((option) => {
      expect(option).toHaveAttribute('data-disabled', 'true')
    })
  })
})
