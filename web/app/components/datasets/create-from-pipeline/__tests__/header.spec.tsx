import { render, screen } from '@testing-library/react'
import { createRef } from 'react'
import Header from '../header'

describe('Header', () => {
  it('links back to the dataset list', () => {
    render(<Header backLinkRef={createRef<HTMLAnchorElement>()} />)

    expect(
      screen.getByRole('link', { name: 'datasetPipeline.creation.backToKnowledge' }),
    ).toHaveAttribute('href', '/datasets')
  })
})
