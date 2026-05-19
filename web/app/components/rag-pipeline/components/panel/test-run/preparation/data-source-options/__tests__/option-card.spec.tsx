import type { DataSourceNodeType } from '@/app/components/workflow/nodes/data-source/types'
import { fireEvent, render, screen } from '@testing-library/react'
import OptionCard from '../option-card'

vi.mock('@/app/components/workflow/hooks', () => ({
  useToolIcon: () => 'source-icon',
}))

vi.mock('@/app/components/workflow/block-icon', () => ({
  default: ({ toolIcon }: { toolIcon: string }) => <div data-testid="block-icon">{toolIcon}</div>,
}))

describe('OptionCard', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('should render the datasource label and icon', () => {
    render(
      <OptionCard
        label="Website Crawl"
        value="website"
        selected={false}
        nodeData={{ title: 'Website Crawl' } as DataSourceNodeType}
      />,
    )

    expect(screen.getByTestId('block-icon')).toHaveTextContent('source-icon')
    expect(screen.getByText('Website Crawl')).toBeInTheDocument()
  })

  it('should call onClick with the card value and apply selected styles', () => {
    const onClick = vi.fn()
    render(
      <OptionCard
        label="Online Drive"
        value="online-drive"
        selected
        nodeData={{ title: 'Online Drive' } as DataSourceNodeType}
        onClick={onClick}
      />,
    )

    fireEvent.click(screen.getByText('Online Drive'))

    expect(onClick).toHaveBeenCalledWith('online-drive')
    expect(screen.getByText('Online Drive')).toHaveClass('text-text-primary')
  })
})
