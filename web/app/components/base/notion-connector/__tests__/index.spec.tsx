import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import NotionConnector from '../index'

describe('NotionConnector', () => {
  it('should render the layout and actual sub-components (Icons & Button)', () => {
    const { container } = render(<NotionConnector onSetting={vi.fn()} />)

    // Verify Title & Tip translations
    expect(screen.getByText('datasetCreation.stepOne.notionSyncTitle')).toBeInTheDocument()
    expect(screen.getByText('datasetCreation.stepOne.notionSyncTip')).toBeInTheDocument()

    const notionWrapper = container.querySelector('.h-12.w-12')
    const dotsWrapper = container.querySelector('.system-md-semibold')

    expect(notionWrapper?.querySelector('svg')).toBeInTheDocument()
    expect(dotsWrapper?.querySelector('svg')).toBeInTheDocument()

    const button = screen.getByRole('button', {
      name: /datasetcreation.stepone.connect/i,
    })

    expect(button).toBeInTheDocument()
  })

  it('should trigger the onSetting callback when the real button is clicked', async () => {
    const onSetting = vi.fn()
    const user = userEvent.setup()
    render(<NotionConnector onSetting={onSetting} />)

    const button = screen.getByRole('button', {
      name: /datasetcreation.stepone.connect/i,
    })

    await user.click(button)

    expect(onSetting).toHaveBeenCalledTimes(1)
  })
})
