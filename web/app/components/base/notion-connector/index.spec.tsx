import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import NotionConnector from './index'

// 1. Robust Mock for translations
const tMock = vi.fn((key, options) => `${options?.ns || 'no-ns'}:${key}`)
vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: tMock }),
}))

// 2. Mock Icons to keep the DOM clean
vi.mock('../icons/src/public/common', () => ({
  Notion: () => <div data-testid="icon-notion" />,
}))
vi.mock('../icons/src/vender/line/others', () => ({
  Icon3Dots: () => <div data-testid="icon-dots" />,
}))

vi.mock('../button', () => ({
  default: ({ children, onClick, variant }: { children: React.ReactNode, onClick: () => void, variant: string }) => (
    <button data-variant={variant} onClick={onClick}>
      {children}
    </button>
  ),
}))

describe('NotionConnector', () => {
  it('should render with correct translations and structure', () => {
    render(<NotionConnector onSetting={vi.fn()} />)

    // Verify Icons
    expect(screen.getByTestId('icon-notion')).toBeInTheDocument()
    expect(screen.getByTestId('icon-dots')).toBeInTheDocument()

    // Verify Namespaced Translations
    expect(screen.getByText('datasetCreation:stepOne.notionSyncTitle')).toBeInTheDocument()
    expect(screen.getByText('datasetCreation:stepOne.notionSyncTip')).toBeInTheDocument()

    // Verify Button text and variant
    const button = screen.getByRole('button')
    expect(button).toHaveTextContent('datasetCreation:stepOne.connect')
    expect(button).toHaveAttribute('data-variant', 'primary')
  })

  it('should trigger onSetting callback on click', async () => {
    const onSetting = vi.fn()
    const user = userEvent.setup()
    render(<NotionConnector onSetting={onSetting} />)

    await user.click(screen.getByRole('button'))
    expect(onSetting).toHaveBeenCalledTimes(1)
  })
})
