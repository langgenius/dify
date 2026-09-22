import type { ReactNode } from 'react'
import type { Timeout as TimeoutPayload } from '../../types'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { useState } from 'react'
import { withSelectorKey } from '@/test/i18n-mock'
import Timeout from './index'

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: withSelectorKey((key: string) => key),
  }),
}))

vi.mock('@/app/components/workflow/store', () => ({
  useStore: (selector: (state: { nodesDefaultConfigs: object }) => unknown) =>
    selector({ nodesDefaultConfigs: {} }),
}))

vi.mock('@/app/components/workflow/nodes/_base/components/collapse', () => ({
  FieldCollapse: ({ children, title }: { children: ReactNode; title: string }) => (
    <section aria-label={title}>{children}</section>
  ),
}))

type TimeoutHarnessProps = {
  onChange: (payload: TimeoutPayload) => void
  readonly?: boolean
}

function TimeoutHarness({ onChange, readonly = false }: TimeoutHarnessProps) {
  const [payload, setPayload] = useState<TimeoutPayload>({ connect: 5, read: 10, write: 15 })

  return (
    <Timeout
      readonly={readonly}
      nodeId="http-node"
      payload={payload}
      onChange={(nextPayload) => {
        setPayload(nextPayload)
        onChange(nextPayload)
      }}
    />
  )
}

describe('HTTP timeout fields', () => {
  it('associates every timeout with its visible label and description', () => {
    render(<TimeoutHarness onChange={vi.fn()} />)

    const connectInput = screen.getByRole('textbox', {
      name: 'nodes.http.timeout.connectLabel',
    })
    const readInput = screen.getByRole('textbox', { name: 'nodes.http.timeout.readLabel' })
    const writeInput = screen.getByRole('textbox', { name: 'nodes.http.timeout.writeLabel' })

    expect(connectInput).toHaveAccessibleDescription('nodes.http.timeout.connectPlaceholder')
    expect(readInput).toHaveAccessibleDescription('nodes.http.timeout.readPlaceholder')
    expect(writeInput).toHaveAccessibleDescription('nodes.http.timeout.writePlaceholder')
  })

  it('stores integer values and maps an empty field to the backend default', async () => {
    const user = userEvent.setup()
    const onChange = vi.fn()
    render(<TimeoutHarness onChange={onChange} />)
    const connectInput = screen.getByRole('textbox', {
      name: 'nodes.http.timeout.connectLabel',
    })

    await user.clear(connectInput)

    expect(onChange).toHaveBeenLastCalledWith({ connect: undefined, read: 10, write: 15 })

    await user.type(connectInput, '8.9')

    expect(onChange).toHaveBeenLastCalledWith({ connect: 9, read: 10, write: 15 })
  })

  it('does not update read-only timeout fields', async () => {
    const user = userEvent.setup()
    const onChange = vi.fn()
    render(<TimeoutHarness readonly onChange={onChange} />)
    const connectInput = screen.getByRole('textbox', {
      name: 'nodes.http.timeout.connectLabel',
    })

    expect(connectInput).toHaveAttribute('readonly')

    await user.type(connectInput, '8')

    expect(onChange).not.toHaveBeenCalled()
  })
})
