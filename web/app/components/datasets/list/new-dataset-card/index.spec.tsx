import { render, screen } from '@testing-library/react'
import NewDatasetCard from './index'

type MockOptionProps = {
  text: string
  href: string
}

// Mock dependencies
vi.mock('./option', () => ({
  default: ({ text, href }: MockOptionProps) => (
    <a data-testid="option-link" href={href}>
      {text}
    </a>
  ),
}))

vi.mock('@remixicon/react', () => ({
  RiAddLine: () => <svg data-testid="icon-add" />,
  RiFunctionAddLine: () => <svg data-testid="icon-function" />,
}))

vi.mock('@/app/components/base/icons/src/vender/solid/development', () => ({
  ApiConnectionMod: () => <svg data-testid="icon-api" />,
}))

describe('NewDatasetCard', () => {
  it('should render all options', () => {
    render(<NewDatasetCard />)

    const options = screen.getAllByTestId('option-link')
    expect(options).toHaveLength(3)

    // Check first option (Create Dataset)
    const createDataset = options[0]
    expect(createDataset).toHaveAttribute('href', '/datasets/create')
    expect(createDataset).toHaveTextContent('dataset.createDataset')

    // Check second option (Create from Pipeline)
    const createFromPipeline = options[1]
    expect(createFromPipeline).toHaveAttribute('href', '/datasets/create-from-pipeline')
    expect(createFromPipeline).toHaveTextContent('dataset.createFromPipeline')

    // Check third option (Connect Dataset)
    const connectDataset = options[2]
    expect(connectDataset).toHaveAttribute('href', '/datasets/connect')
    expect(connectDataset).toHaveTextContent('dataset.connectDataset')
  })
})
