import type { ReactNode } from 'react'
import { render, screen } from '@testing-library/react'
import { ChunkStructureEnum } from '../../../types'
import ChunkStructure from '../index'

const mockUseChunkStructure = vi.hoisted(() => vi.fn())

vi.mock('@/app/components/workflow/nodes/_base/components/layout', () => ({
  Field: ({ children, fieldTitleProps }: { children: ReactNode, fieldTitleProps: { title: string, warningDot?: boolean, operation?: ReactNode } }) => (
    <div data-testid="field" data-warning-dot={String(!!fieldTitleProps.warningDot)}>
      <div>{fieldTitleProps.title}</div>
      {fieldTitleProps.operation}
      {children}
    </div>
  ),
}))

vi.mock('../hooks', () => ({
  useChunkStructure: mockUseChunkStructure,
}))

vi.mock('../../option-card', () => ({
  default: ({ title }: { title: string }) => <div data-testid="option-card">{title}</div>,
}))

vi.mock('../selector', () => ({
  default: ({ trigger, value }: { trigger?: ReactNode, value?: string }) => (
    <div data-testid="selector">
      {value ?? 'no-value'}
      {trigger}
    </div>
  ),
}))

vi.mock('../instruction', () => ({
  default: ({ className }: { className?: string }) => <div data-testid="instruction" className={className}>Instruction</div>,
}))

describe('ChunkStructure', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockUseChunkStructure.mockReturnValue({
      options: [{ value: ChunkStructureEnum.general, label: 'General' }],
      optionMap: {
        [ChunkStructureEnum.general]: {
          title: 'General Chunk Structure',
        },
      },
    })
  })

  it('should render the selected option and warning dot metadata when a chunk structure is chosen', () => {
    render(
      <ChunkStructure
        chunkStructure={ChunkStructureEnum.general}
        warningDot
        onChunkStructureChange={vi.fn()}
      />,
    )

    expect(screen.getByTestId('field')).toHaveAttribute('data-warning-dot', 'true')
    expect(screen.getByTestId('selector')).toHaveTextContent(ChunkStructureEnum.general)
    expect(screen.getByTestId('option-card')).toHaveTextContent('General Chunk Structure')
    expect(screen.queryByTestId('instruction')).not.toBeInTheDocument()
  })

  it('should render the add trigger and instruction when no chunk structure is selected', () => {
    render(
      <ChunkStructure
        onChunkStructureChange={vi.fn()}
      />,
    )

    expect(screen.getByRole('button', { name: /chooseChunkStructure/i })).toBeInTheDocument()
    expect(screen.getByTestId('instruction')).toBeInTheDocument()
  })
})
