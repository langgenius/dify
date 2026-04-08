import { render, screen } from '@testing-library/react'
import HitHistoryNoData from '../hit-history-no-data'

describe('HitHistoryNoData', () => {
  it('should render the empty history message', () => {
    render(<HitHistoryNoData />)

    expect(screen.getByText('appAnnotation.viewModal.noHitHistory')).toBeInTheDocument()
  })
})
