import type { AgentConfig } from '@/models/debug'
import { act, fireEvent, render, screen } from '@testing-library/react'
import * as React from 'react'
import { MAX_ITERATIONS_NUM } from '@/config'
import AgentSetting from './index'

vi.mock('ahooks', async (importOriginal) => {
  const actual = await importOriginal<typeof import('ahooks')>()
  return {
    ...actual,
    useClickAway: vi.fn(),
  }
})

vi.mock('react-slider', () => ({
  default: (props: { className?: string, min?: number, max?: number, value: number, onChange: (value: number) => void }) => (
    <input
      type="range"
      className={props.className}
      min={props.min}
      max={props.max}
      value={props.value}
      onChange={e => props.onChange(Number(e.target.value))}
    />
  ),
}))

const basePayload = {
  enabled: true,
  strategy: 'react',
  max_iteration: 5,
  tools: [],
}

const renderModal = (props?: Partial<React.ComponentProps<typeof AgentSetting>>) => {
  const onCancel = vi.fn()
  const onSave = vi.fn()
  const utils = render(
    <AgentSetting
      isChatModel
      payload={basePayload as AgentConfig}
      isFunctionCall={false}
      onCancel={onCancel}
      onSave={onSave}
      {...props}
    />,
  )
  return { ...utils, onCancel, onSave }
}

describe('AgentSetting', () => {
  it('should render agent mode description and default prompt section when not function call', () => {
    renderModal()

    expect(screen.getByText('appDebug.agent.agentMode')).toBeInTheDocument()
    expect(screen.getByText('appDebug.agent.agentModeType.ReACT')).toBeInTheDocument()
    expect(screen.getByText('tools.builtInPromptTitle')).toBeInTheDocument()
  })

  it('should display function call mode when isFunctionCall true', () => {
    renderModal({ isFunctionCall: true })

    expect(screen.getByText('appDebug.agent.agentModeType.functionCall')).toBeInTheDocument()
    expect(screen.queryByText('tools.builtInPromptTitle')).not.toBeInTheDocument()
  })

  it('should update iteration via slider and number input', () => {
    const { container } = renderModal()
    const slider = container.querySelector('.slider') as HTMLInputElement
    const numberInput = screen.getByRole('spinbutton')

    fireEvent.change(slider, { target: { value: '7' } })
    expect(screen.getAllByDisplayValue('7')).toHaveLength(2)

    fireEvent.change(numberInput, { target: { value: '2' } })
    expect(screen.getAllByDisplayValue('2')).toHaveLength(2)
  })

  it('should clamp iteration value within min/max range', () => {
    renderModal()

    const numberInput = screen.getByRole('spinbutton')

    fireEvent.change(numberInput, { target: { value: '0' } })
    expect(screen.getAllByDisplayValue('1')).toHaveLength(2)

    fireEvent.change(numberInput, { target: { value: '999' } })
    expect(screen.getAllByDisplayValue(String(MAX_ITERATIONS_NUM))).toHaveLength(2)
  })

  it('should call onCancel when cancel button clicked', () => {
    const { onCancel } = renderModal()
    fireEvent.click(screen.getByRole('button', { name: 'common.operation.cancel' }))
    expect(onCancel).toHaveBeenCalled()
  })

  it('should call onSave with updated payload', async () => {
    const { onSave } = renderModal()
    const numberInput = screen.getByRole('spinbutton')
    fireEvent.change(numberInput, { target: { value: '6' } })

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'common.operation.save' }))
    })

    expect(onSave).toHaveBeenCalledWith(expect.objectContaining({ max_iteration: 6 }))
  })
})
