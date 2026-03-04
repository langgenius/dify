import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { useTranslation } from 'react-i18next'
import PriorityUseTip from './priority-use-tip'

vi.mock('react-i18next', async (importOriginal) => {
  const actual = await importOriginal<typeof import('react-i18next')>()
  return { ...actual, useTranslation: vi.fn() }
})

describe('PriorityUseTip', () => {
  const createTranslationResult = (tImpl: (key: string) => string) => ({
    t: tImpl,
    i18n: {} as unknown as ReturnType<typeof useTranslation>['i18n'],
    ready: true,
  }) as unknown as ReturnType<typeof useTranslation>

  beforeEach(() => {
    vi.clearAllMocks()
    vi.mocked(useTranslation).mockReturnValue(createTranslationResult((key: string) => key))
  })

  it('should render tooltip with icon content', async () => {
    const user = userEvent.setup()
    const { container } = render(<PriorityUseTip />)
    const trigger = container.querySelector('.cursor-pointer')
    expect(trigger).toBeInTheDocument()

    await user.hover(trigger as HTMLElement)

    expect(await screen.findByText('modelProvider.priorityUsing')).toBeInTheDocument()
  })

  it('should render the component without crashing', () => {
    const { container } = render(<PriorityUseTip />)
    expect(container.firstChild).toBeInTheDocument()
  })

  it('should exercise || fallback when t() returns empty string', async () => {
    const user = userEvent.setup()
    vi.mocked(useTranslation).mockReturnValue(createTranslationResult(() => ''))
    const { container } = render(<PriorityUseTip />)
    const trigger = container.querySelector('.cursor-pointer')
    expect(trigger).toBeInTheDocument()

    await user.hover(trigger as HTMLElement)

    expect(screen.queryByText('modelProvider.priorityUsing')).not.toBeInTheDocument()
    expect(document.querySelector('.rounded-md.bg-components-panel-bg')).not.toBeInTheDocument()
  })
})
