import { render, screen } from '@testing-library/react'
import StepThree from '../index'

vi.mock('../../embedding-process', () => ({
  default: () => <div>embedding process</div>,
}))

vi.mock('@/context/i18n', () => ({
  useDocLink: () => (path: string) => `https://docs.dify.ai${path}`,
}))

vi.mock('@/hooks/use-breakpoints', () => ({
  MediaType: {
    mobile: 'mobile',
    tablet: 'tablet',
    pc: 'pc',
  },
  default: () => 'pc',
}))

describe('StepThree', () => {
  it('shows the created dataset while its documents are processed', () => {
    render(<StepThree datasetName="Product docs" />)

    expect(screen.getByText('datasetCreation.stepThree.creationTitle')).toBeInTheDocument()
    expect(screen.getByText('Product docs')).toBeInTheDocument()
  })

  it('shows the target dataset while additional documents are processed', () => {
    render(<StepThree datasetId="dataset-1" datasetName="Product docs" />)

    expect(screen.getByText('datasetCreation.stepThree.additionTitle')).toBeInTheDocument()
    expect(screen.getByText(/Product docs/)).toBeInTheDocument()
    expect(screen.queryByText('datasetCreation.stepThree.creationTitle')).not.toBeInTheDocument()
  })

  it('links to the document-processing documentation', () => {
    render(<StepThree />)

    expect(
      screen.getByRole('link', { name: 'datasetPipeline.addDocuments.stepThree.learnMore' }),
    ).toHaveAttribute(
      'href',
      'https://docs.dify.ai/use-dify/knowledge/integrate-knowledge-within-application',
    )
  })
})
