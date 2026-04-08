import { render, screen } from '@testing-library/react'
import ResPlaceholder from '../res-placeholder'

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, options?: { ns?: string }) => options?.ns ? `${options.ns}.${key}` : key,
  }),
}))

describe('ResPlaceholder', () => {
  it('should render the placeholder copy', () => {
    render(<ResPlaceholder />)

    expect(screen.getByText('appDebug.generate.newNoDataLine1')).toBeInTheDocument()
  })
})
