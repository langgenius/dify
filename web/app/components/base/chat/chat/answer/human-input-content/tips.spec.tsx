import type { AppContextValue } from '@/context/app-context'
import { render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { useSelector } from '@/context/app-context'
import Tips from './tips'

// Mock AppContext's useSelector to control user profile data
vi.mock('@/context/app-context', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/context/app-context')>()
  return {
    ...actual,
    useSelector: vi.fn(),
  }
})

describe('Tips', () => {
  const mockEmail = 'test@example.com'

  beforeEach(() => {
    vi.clearAllMocks()
    vi.mocked(useSelector).mockImplementation((selector: (value: AppContextValue) => unknown) => {
      return selector({
        userProfile: {
          email: mockEmail,
        },
      } as AppContextValue)
    })
  })

  it('should render email tip in normal mode', () => {
    render(
      <Tips
        showEmailTip={true}
        isEmailDebugMode={false}
        showDebugModeTip={false}
      />,
    )

    expect(screen.getByText('workflow.common.humanInputEmailTip')).toBeInTheDocument()
    expect(screen.queryByText('common.humanInputEmailTipInDebugMode')).not.toBeInTheDocument()
    expect(screen.queryByText('workflow.common.humanInputWebappTip')).not.toBeInTheDocument()
  })

  it('should render email tip in debug mode', () => {
    render(
      <Tips
        showEmailTip={true}
        isEmailDebugMode={true}
        showDebugModeTip={false}
      />,
    )

    expect(screen.getByText('common.humanInputEmailTipInDebugMode')).toBeInTheDocument()
    expect(screen.queryByText('workflow.common.humanInputEmailTip')).not.toBeInTheDocument()
  })

  it('should render debug mode tip', () => {
    render(
      <Tips
        showEmailTip={false}
        isEmailDebugMode={false}
        showDebugModeTip={true}
      />,
    )

    expect(screen.getByText('workflow.common.humanInputWebappTip')).toBeInTheDocument()
    expect(screen.queryByText('workflow.common.humanInputEmailTip')).not.toBeInTheDocument()
  })

  it('should render nothing when all flags are false', () => {
    const { container } = render(
      <Tips
        showEmailTip={false}
        isEmailDebugMode={false}
        showDebugModeTip={false}
      />,
    )

    expect(screen.queryByTestId('tips')).toBeEmptyDOMElement()
    // Divider is outside of tips container, but within the fragment
    expect(container.querySelector('.v-divider')).toBeDefined()
  })
})
