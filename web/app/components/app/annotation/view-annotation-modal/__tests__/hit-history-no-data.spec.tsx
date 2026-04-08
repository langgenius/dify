import { render, screen } from '@testing-library/react'
import HitHistoryNoData from '../hit-history-no-data'

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, options?: { ns?: string }) => options?.ns ? `${options.ns}.${key}` : key,
  }),
}))

describe('HitHistoryNoData', () => {
  it('should render the empty history message', () => {
    render(<HitHistoryNoData />)

    expect(screen.getByText('appAnnotation.viewModal.noHitHistory')).toBeInTheDocument()
  })
})
