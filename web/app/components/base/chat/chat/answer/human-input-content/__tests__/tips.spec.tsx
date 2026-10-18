import { screen } from '@testing-library/react'
import { describe, expect, it } from 'vite-plus/test'
import { renderWithAccountProfile } from '@/test/console/account-profile'
import { render } from '@/test/console/render'
import Tips from '../tips'

describe('Tips', () => {
  it('should render email tip in normal mode', () => {
    render(<Tips showEmailTip={true} isEmailDebugMode={false} showDebugModeTip={false} />)

    expect(screen.getByText('workflow.common.humanInputEmailTip')).toBeInTheDocument()
    expect(
      screen.queryByText('workflow.common.humanInputEmailTipInDebugMode'),
    ).not.toBeInTheDocument()
    expect(screen.queryByText('workflow.common.humanInputWebappTip')).not.toBeInTheDocument()
  })

  it('should render email tip in debug mode', () => {
    renderWithAccountProfile(
      <Tips showEmailTip={true} isEmailDebugMode={true} showDebugModeTip={false} />,
      { accountProfile: { email: 'test@example.com' } },
    )

    expect(screen.getByText('workflow.common.humanInputEmailTipInDebugMode')).toBeInTheDocument()
    expect(screen.queryByText('workflow.common.humanInputEmailTip')).not.toBeInTheDocument()
  })

  it('should render debug mode tip', () => {
    render(<Tips showEmailTip={false} isEmailDebugMode={false} showDebugModeTip={true} />)

    expect(screen.getByText('workflow.common.humanInputWebappTip')).toBeInTheDocument()
    expect(screen.queryByText('workflow.common.humanInputEmailTip')).not.toBeInTheDocument()
  })

  it('should render nothing when all flags are false', () => {
    render(<Tips showEmailTip={false} isEmailDebugMode={false} showDebugModeTip={false} />)

    expect(screen.queryByTestId('tips')).toBeEmptyDOMElement()
  })
})
