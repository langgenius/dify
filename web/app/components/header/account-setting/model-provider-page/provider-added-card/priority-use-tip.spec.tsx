import { render } from '@testing-library/react'
import { useTranslation } from 'react-i18next'
import PriorityUseTip from './priority-use-tip'

vi.mock('react-i18next', async (importOriginal) => {
  const actual = await importOriginal<typeof import('react-i18next')>()
  return { ...actual, useTranslation: vi.fn() }
})

describe('PriorityUseTip', () => {
  const createTranslationResult = (tImpl: (key: string) => string) => [
    tImpl,
    {} as unknown as ReturnType<typeof useTranslation>['i18n'],
    true,
  ] as unknown as ReturnType<typeof useTranslation>

  beforeEach(() => {
    vi.clearAllMocks()
    vi.mocked(useTranslation).mockReturnValue(createTranslationResult((key: string) => key))
  })

  it('should render tooltip with icon content', () => {
    const { container } = render(<PriorityUseTip />)
    expect(container.querySelector('[data-state]')).toBeInTheDocument()
  })

  it('should render the component without crashing', () => {
    const { container } = render(<PriorityUseTip />)
    expect(container.firstChild).toBeInTheDocument()
  })

  it('should exercise || fallback when t() returns empty string', () => {
    vi.mocked(useTranslation).mockReturnValue(createTranslationResult(() => ''))
    const { container } = render(<PriorityUseTip />)
    expect(container.firstChild).toBeInTheDocument()
  })
})
