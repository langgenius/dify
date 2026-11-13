import type { Limit } from '../../types'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { useState } from 'react'
import LimitConfig from '../limit-config'

describe('list-operator/limit-config', () => {
  it('reveals and edits the limit after enabling it', async () => {
    const user = userEvent.setup()
    const onChange = vi.fn()
    function Harness() {
      const [config, setConfig] = useState<Limit>({ enabled: false, size: 10 })
      return (
        <LimitConfig
          readonly={false}
          config={config}
          onChange={(next) => {
            setConfig(next)
            onChange(next)
          }}
        />
      )
    }
    render(<Harness />)
    expect(screen.queryByRole('spinbutton')).not.toBeInTheDocument()

    await user.click(screen.getByRole('switch'))
    expect(onChange).toHaveBeenLastCalledWith({ enabled: true, size: 10 })
    const input = screen.getByRole('spinbutton', { name: 'workflowLogic.nodes.listFilter.limit' })
    await user.clear(input)
    await user.type(input, '7')
    await user.tab()
    expect(onChange).toHaveBeenLastCalledWith({ enabled: true, size: 7 })
    expect(input).toHaveValue(7)
  })

  it('prevents editing or disabling a read-only limit', async () => {
    const user = userEvent.setup()
    const onChange = vi.fn()
    render(<LimitConfig readonly config={{ enabled: true, size: 6 }} onChange={onChange} />)

    const input = screen.getByRole('spinbutton')
    expect(input).toBeDisabled()
    expect(screen.getByRole('switch')).toHaveAttribute('aria-disabled', 'true')
    await user.type(input, '7')
    await user.click(screen.getByRole('switch'))
    expect(input).toHaveValue(6)
    expect(onChange).not.toHaveBeenCalled()
  })
})
