import { useQuery } from '@tanstack/react-query'
import { fireEvent, render, screen } from '@testing-library/react'
import { setLocaleOnClient } from '@/i18n-config'
import Header from '../_header'

vi.mock('@tanstack/react-query', async () => {
  const actual = await vi.importActual<typeof import('@tanstack/react-query')>('@tanstack/react-query')
  return {
    ...actual,
    useQuery: vi.fn(),
  }
})

vi.mock('@/context/i18n', () => ({
  useLocale: () => 'en-US',
}))

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

const mockUseQuery = vi.mocked(useQuery)
const mockSetLocaleOnClient = vi.mocked(setLocaleOnClient)

describe('Signin Header', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockUseQuery.mockReturnValue({
      data: {
        branding: {
          enabled: false,
          login_page_logo: '',
        },
      },
    } as ReturnType<typeof useQuery>)
  })

  it('should switch locale without forcing a full page reload', () => {
    render(<Header />)

    fireEvent.click(screen.getByRole('button', { name: 'Switch Language' }))

    expect(mockSetLocaleOnClient).toHaveBeenCalledWith('ja-JP', false)
  })
})
