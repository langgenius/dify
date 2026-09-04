import { fireEvent, render, screen } from '@testing-library/react'
import { AgentAdvancedSettings } from '../index'

vi.mock('../env', () => ({
  AgentEnvEditor: () => <div>advanced-env-editor</div>,
}))

vi.mock('../content-moderation', () => ({
  AgentContentModerationSettings: () => <div>advanced-content-moderation</div>,
}))

describe('AgentAdvancedSettings', () => {
  it('should render collapsed by default and expand from the section trigger', () => {
    render(<AgentAdvancedSettings />)

    const label = 'agentV2.agentDetail.configure.advancedSettings.label'
    const trigger = screen.getByRole('button', { name: label })

    expect(trigger).not.toHaveAttribute('data-panel-open')
    expect(screen.queryByText('advanced-env-editor')).not.toBeInTheDocument()
    expect(screen.queryByText('advanced-content-moderation')).not.toBeInTheDocument()

    fireEvent.click(trigger)

    expect(screen.getByText('advanced-env-editor')).toBeInTheDocument()
    expect(screen.queryByText('advanced-content-moderation')).not.toBeInTheDocument()
  })
})
