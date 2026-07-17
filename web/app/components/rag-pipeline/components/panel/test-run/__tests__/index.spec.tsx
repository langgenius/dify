import { render, screen } from '@testing-library/react'
import TestRunPanel from '../index'

let isPreparingDataSource = true

vi.mock('@/app/components/workflow/store', () => ({
  useStore: (selector: (state: { isPreparingDataSource: boolean }) => unknown) =>
    selector({ isPreparingDataSource }),
}))

vi.mock('../header', () => ({
  default: () => <div>Test run header</div>,
}))

vi.mock('../preparation', () => ({
  default: () => <div>Preparation</div>,
}))

vi.mock('../result', () => ({
  default: () => <div>Result</div>,
}))

vi.mock(
  '@/app/components/datasets/documents/create-from-pipeline/data-source/store/provider',
  () => ({
    default: ({ children }: { children: React.ReactNode }) => children,
  }),
)

describe('TestRunPanel', () => {
  beforeEach(() => {
    isPreparingDataSource = true
  })

  it('shows datasource preparation before a run', () => {
    render(<TestRunPanel />)

    expect(screen.getByText('Preparation')).toBeInTheDocument()
    expect(screen.queryByText('Result')).not.toBeInTheDocument()
  })

  it('shows the result after datasource preparation', () => {
    isPreparingDataSource = false

    render(<TestRunPanel />)

    expect(screen.getByText('Result')).toBeInTheDocument()
    expect(screen.queryByText('Preparation')).not.toBeInTheDocument()
  })
})
