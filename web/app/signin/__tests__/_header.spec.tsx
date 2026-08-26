import { fireEvent, screen } from '@testing-library/react'
import { setLocaleOnClient } from '@/i18n-config'
import { renderWithConsoleQuery as render } from '@/test/console/query-data'
import Header from '../_header'

vi.mock('@/i18n-config', () => ({
  setLocaleOnClient: vi.fn(),
}))

vi.mock('@/next/dynamic', () => ({
  default: () => () => null,
}))

vi.mock('../_locale-menu', () => ({
  default: ({ onChange }: { onChange?: (value: string) => void }) => (
    <button type="button" onClick={() => onChange?.('ja-JP')}>
      Switch Language
    </button>
  ),
}))

const mockSetLocaleOnClient = vi.mocked(setLocaleOnClient)

describe('Signin Header', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('should switch locale without forcing a full page reload', () => {
    render(<Header />)

    fireEvent.click(screen.getByRole('button', { name: 'Switch Language' }))

    expect(mockSetLocaleOnClient).toHaveBeenCalledWith('ja-JP', false)
  })
})
