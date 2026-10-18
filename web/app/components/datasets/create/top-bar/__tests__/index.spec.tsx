import { render, screen } from '@testing-library/react'
import { TopBar } from '../index'

describe('TopBar', () => {
  it('returns to the dataset list while creating a new dataset', () => {
    render(<TopBar activeIndex={0} />)

    expect(
      screen.getByRole('link', { name: 'datasetCreation.steps.header.fallbackRoute' }),
    ).toHaveAttribute('href', '/datasets')
  })

  it('returns to the dataset documents while adding documents', () => {
    render(<TopBar activeIndex={1} datasetId="dataset-1" />)

    expect(
      screen.getByRole('link', { name: 'datasetCreation.steps.header.fallbackRoute' }),
    ).toHaveAttribute('href', '/datasets/dataset-1/documents')
  })

  it('announces the active creation step in the visible stepper', () => {
    render(<TopBar activeIndex={1} />)

    expect(screen.getByText('STEP 2')).toBeInTheDocument()
    expect(screen.getByText('datasetCreation.steps.two')).toBeInTheDocument()
  })
})
