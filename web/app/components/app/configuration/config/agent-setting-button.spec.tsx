import type { AgentConfig } from '@/models/debug'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import * as React from 'react'
import { AgentStrategy } from '@/types/app'
import AgentSettingButton from './agent-setting-button'

let latestAgentSettingProps: any
vi.mock('./agent/agent-setting', () => ({
  default: (props: any) => {
    latestAgentSettingProps = props
    return (
      <div data-testid="agent-setting">
        <button onClick={() => props.onSave({ ...props.payload, max_iteration: 9 })}>
          save-agent
        </button>
        <button onClick={props.onCancel}>
          cancel-agent
        </button>
      </div>
    )
  },
}))

const createAgentConfig = (overrides: Partial<AgentConfig> = {}): AgentConfig => ({
  enabled: true,
  strategy: AgentStrategy.react,
  max_iteration: 3,
  tools: [],
  ...overrides,
})

const setup = (overrides: Partial<React.ComponentProps<typeof AgentSettingButton>> = {}) => {
  const props: React.ComponentProps<typeof AgentSettingButton> = {
    isFunctionCall: false,
    isChatModel: true,
    onAgentSettingChange: vi.fn(),
    agentConfig: createAgentConfig(),
    ...overrides,
  }

  const user = userEvent.setup()
  render(<AgentSettingButton {...props} />)
  return { props, user }
}

beforeEach(() => {
  vi.clearAllMocks()
  latestAgentSettingProps = undefined
})

describe('AgentSettingButton', () => {
  it('should render button label from translation key', () => {
    setup()

    expect(screen.getByRole('button', { name: 'appDebug.agent.setting.name' })).toBeInTheDocument()
  })

  it('should open AgentSetting with the provided configuration when clicked', async () => {
    const { user, props } = setup({ isFunctionCall: true, isChatModel: false })

    await user.click(screen.getByRole('button', { name: 'appDebug.agent.setting.name' }))

    expect(screen.getByTestId('agent-setting')).toBeInTheDocument()
    expect(latestAgentSettingProps.isFunctionCall).toBe(true)
    expect(latestAgentSettingProps.isChatModel).toBe(false)
    expect(latestAgentSettingProps.payload).toEqual(props.agentConfig)
  })

  it('should call onAgentSettingChange and close when AgentSetting saves', async () => {
    const { user, props } = setup()

    await user.click(screen.getByRole('button', { name: 'appDebug.agent.setting.name' }))
    await user.click(screen.getByText('save-agent'))

    expect(props.onAgentSettingChange).toHaveBeenCalledTimes(1)
    expect(props.onAgentSettingChange).toHaveBeenCalledWith({
      ...props.agentConfig,
      max_iteration: 9,
    })
    expect(screen.queryByTestId('agent-setting')).not.toBeInTheDocument()
  })

  it('should close AgentSetting without saving when cancel is triggered', async () => {
    const { user, props } = setup()

    await user.click(screen.getByRole('button', { name: 'appDebug.agent.setting.name' }))
    await user.click(screen.getByText('cancel-agent'))

    expect(props.onAgentSettingChange).not.toHaveBeenCalled()
    expect(screen.queryByTestId('agent-setting')).not.toBeInTheDocument()
  })
})
