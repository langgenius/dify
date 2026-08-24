import type { TestRunMenuRef, TriggerOption } from '../test-run-menu'
import { fireEvent, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { act } from 'react'
import * as React from 'react'
import TestRunMenu, { TriggerType } from '../test-run-menu'

const createOption = (overrides: Partial<TriggerOption> = {}): TriggerOption => ({
  id: 'user-input',
  type: TriggerType.UserInput,
  name: 'User Input',
  icon: <span>icon</span>,
  enabled: true,
  ...overrides,
})

describe('TestRunMenu', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('should run the only enabled option directly and preserve the child click handler', async () => {
    const user = userEvent.setup()
    const onSelect = vi.fn()
    const originalOnClick = vi.fn()

    render(
      <TestRunMenu
        options={{
          userInput: createOption(),
          triggers: [],
        }}
        onSelect={onSelect}
      >
        <button onClick={originalOnClick}>Run now</button>
      </TestRunMenu>,
    )

    await user.click(screen.getByRole('button', { name: 'Run now' }))

    expect(originalOnClick).toHaveBeenCalledTimes(1)
    expect(onSelect).toHaveBeenCalledWith(expect.objectContaining({ id: 'user-input' }))
  })

  it('should expose toggle via ref and select a shortcut when multiple options are available', () => {
    const onSelect = vi.fn()

    const Harness = () => {
      const ref = React.useRef<TestRunMenuRef>(null)

      return (
        <>
          <button onClick={() => ref.current?.toggle()}>Toggle via ref</button>
          <TestRunMenu
            ref={ref}
            options={{
              userInput: createOption(),
              runAll: createOption({ id: 'run-all', type: TriggerType.All, name: 'Run All' }),
              triggers: [
                createOption({
                  id: 'trigger-1',
                  type: TriggerType.Webhook,
                  name: 'Webhook Trigger',
                }),
              ],
            }}
            onSelect={onSelect}
          >
            <button>Open menu</button>
          </TestRunMenu>
        </>
      )
    }

    render(<Harness />)

    act(() => {
      fireEvent.click(screen.getByRole('button', { name: 'Toggle via ref' }))
    })
    expect(screen.getByText('~')).toBeInTheDocument()

    fireEvent.keyDown(window, { key: '0' })

    expect(onSelect).toHaveBeenCalledWith(expect.objectContaining({ id: 'run-all' }))
  })

  it('should ignore disabled options in the rendered menu', async () => {
    const user = userEvent.setup()

    render(
      <TestRunMenu
        options={{
          userInput: createOption({ enabled: false }),
          runAll: createOption({ id: 'run-all', type: TriggerType.All, name: 'Run All' }),
          triggers: [
            createOption({ id: 'trigger-1', type: TriggerType.Webhook, name: 'Webhook Trigger' }),
          ],
        }}
        onSelect={vi.fn()}
      >
        <button>Open menu</button>
      </TestRunMenu>,
    )

    await user.click(screen.getByRole('button', { name: 'Open menu' }))

    expect(screen.queryByText('User Input')).not.toBeInTheDocument()
    expect(screen.getByText('Webhook Trigger')).toBeInTheDocument()
  })
})
