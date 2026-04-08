import { render, screen } from '@testing-library/react'
import GlobalInputs from '../global-inputs'

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, options?: { ns?: string }) => options?.ns ? `${options.ns}.${key}` : key,
  }),
}))

vi.mock('@/app/components/base/tooltip', () => ({
  default: ({
    popupContent,
  }: {
    popupContent: React.ReactNode
  }) => <div data-testid="tooltip">{popupContent}</div>,
}))

describe('GlobalInputs', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('should render the title and tooltip copy', () => {
    render(<GlobalInputs />)

    expect(screen.getByText('datasetPipeline.inputFieldPanel.globalInputs.title')).toBeInTheDocument()
    expect(screen.getByTestId('tooltip')).toHaveTextContent('datasetPipeline.inputFieldPanel.globalInputs.tooltip')
  })
})
