import { render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import Tips from '../tips'

const mockAppContextState = vi.hoisted(() => ({
  userProfile: {
    email: 'test@example.com',
  },
}))

vi.mock('@/context/app-context-state', async (importOriginal) => {
  const { createAppContextStateAtomMock } = await import('@/__tests__/utils/mock-app-context-state')

  return createAppContextStateAtomMock(importOriginal, () => mockAppContextState)
})

vi.mock('jotai', async (importOriginal) => {
  const { createAppContextStateJotaiMock } = await import('@/__tests__/utils/mock-app-context-state')

  return createAppContextStateJotaiMock(importOriginal)
})

describe('Tips', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockAppContextState.userProfile.email = 'test@example.com'
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
