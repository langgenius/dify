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
    const triggers = screen.getAllByRole('button', { name: label })

    expect(triggers[0]).not.toHaveAttribute('data-panel-open')
    expect(screen.queryByText('advanced-env-editor')).not.toBeInTheDocument()
    expect(screen.queryByText('advanced-content-moderation')).not.toBeInTheDocument()

    fireEvent.click(triggers[0]!)

    expect(screen.getByText('advanced-env-editor')).toBeInTheDocument()
    expect(screen.queryByText('advanced-content-moderation')).not.toBeInTheDocument()
  })
})
