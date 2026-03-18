import type { i18n } from 'i18next'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import * as reactI18next from 'react-i18next'
import PriorityUseTip from '../priority-use-tip'

describe('PriorityUseTip', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.restoreAllMocks()
  })

  it('should render tooltip with icon content', async () => {
    const user = userEvent.setup()
    const { container } = render(<PriorityUseTip />)
    const trigger = container.querySelector('.cursor-pointer')
    expect(trigger).toBeInTheDocument()

    await user.hover(trigger as HTMLElement)

    expect(await screen.findByText('common.modelProvider.priorityUsing')).toBeInTheDocument()
  })

  it('should render the component without crashing', () => {
    const { container } = render(<PriorityUseTip />)
    expect(container.firstChild).toBeInTheDocument()
  })

  it('should exercise || fallback when t() returns empty string', async () => {
    const user = userEvent.setup()
    vi.spyOn(reactI18next, 'useTranslation').mockReturnValue({
      t: () => '',
      i18n: {} as unknown as i18n,
      ready: true,
    } as unknown as ReturnType<typeof reactI18next.useTranslation>)
    const { container } = render(<PriorityUseTip />)
    const trigger = container.querySelector('.cursor-pointer')
    expect(trigger).toBeInTheDocument()

    await user.hover(trigger as HTMLElement)

    expect(screen.queryByText('common.modelProvider.priorityUsing')).not.toBeInTheDocument()
    expect(document.querySelector('.rounded-md.bg-components-panel-bg')).not.toBeInTheDocument()
  })
})
