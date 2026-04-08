import { render, screen } from '@testing-library/react'
import FooterTips from '../footer-tips'

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, options?: { ns?: string }) => options?.ns ? `${options.ns}.${key}` : key,
  }),
}))

describe('FooterTips', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('should render the localized footer copy', () => {
    render(<FooterTips />)

    expect(screen.getByText('datasetPipeline.testRun.tooltip')).toBeInTheDocument()
  })
})
