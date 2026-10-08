import type { Authorization } from '../../../types'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { useState } from 'react'
import { AuthorizationDialog } from '..'
import { APIType, AuthorizationType } from '../../../types'

vi.mock('@/app/components/workflow/nodes/_base/hooks/use-available-var-list', () => ({
  default: () => ({ availableVars: [], availableNodesWithParent: [] }),
}))

vi.mock('@/app/components/workflow/nodes/_base/components/input-support-select-var', () => ({
  default: ({ value, onChange }: { value: string; onChange: (value: string) => void }) => (
    <input aria-label="API key" value={value} onChange={(event) => onChange(event.target.value)} />
  ),
}))

const initialAuthorization: Authorization = {
  type: AuthorizationType.apiKey,
  config: { type: APIType.custom, header: 'X-Original', api_key: 'original-key' },
}

function AuthorizationSettings({ onSave }: { onSave: (value: Authorization) => void }) {
  const [authorization, setAuthorization] = useState(initialAuthorization)

  return (
    <AuthorizationDialog
      nodeId="http-node"
      payload={authorization}
      readOnly={false}
      onChange={(value) => {
        onSave(value)
        setAuthorization(value)
      }}
    />
  )
}

const triggerName = /nodes.http.authorization.authorization/
const headerName = /nodes.http.authorization.header/

async function expectClosed() {
  await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
}

describe('HTTP authorization dialog', () => {
  it('discards a cancelled draft and saves only the next confirmed draft', async () => {
    const user = userEvent.setup()
    const onSave = vi.fn()
    render(<AuthorizationSettings onSave={onSave} />)

    await user.click(screen.getByRole('button', { name: triggerName }))
    await user.clear(screen.getByRole('textbox', { name: headerName }))
    await user.type(screen.getByRole('textbox', { name: headerName }), 'X-Cancelled')
    await user.click(screen.getByRole('button', { name: 'common.operation.cancel' }))
    await expectClosed()
    expect(onSave).not.toHaveBeenCalled()

    await user.click(screen.getByRole('button', { name: triggerName }))
    expect(screen.getByRole('textbox', { name: headerName })).toHaveValue('X-Original')
    await user.clear(screen.getByRole('textbox', { name: headerName }))
    await user.type(screen.getByRole('textbox', { name: headerName }), 'X-Saved')
    await user.click(screen.getByRole('button', { name: 'common.operation.save' }))
    await expectClosed()
    expect(onSave).toHaveBeenCalledExactlyOnceWith({
      ...initialAuthorization,
      config: { ...initialAuthorization.config, header: 'X-Saved' },
    })

    await user.click(screen.getByRole('button', { name: triggerName }))
    expect(screen.getByRole('textbox', { name: headerName })).toHaveValue('X-Saved')
  })

  it('saves a header through the form submit button when Enter is pressed', async () => {
    const user = userEvent.setup()
    const onSave = vi.fn()
    render(<AuthorizationSettings onSave={onSave} />)

    await user.click(screen.getByRole('button', { name: triggerName }))
    await user.clear(screen.getByRole('textbox', { name: headerName }))
    await user.type(screen.getByRole('textbox', { name: headerName }), 'X-Enter{Enter}')
    await expectClosed()
    expect(onSave).toHaveBeenCalledExactlyOnceWith({
      ...initialAuthorization,
      config: { ...initialAuthorization.config, header: 'X-Enter' },
    })
  })

  it('ends the editable session when the node becomes read-only', async () => {
    const user = userEvent.setup()
    const onSave = vi.fn()
    const { rerender } = render(
      <AuthorizationDialog
        nodeId="http-node"
        payload={initialAuthorization}
        readOnly={false}
        onChange={onSave}
      />,
    )

    await user.click(screen.getByRole('button', { name: triggerName }))
    await user.clear(screen.getByRole('textbox', { name: headerName }))
    await user.type(screen.getByRole('textbox', { name: headerName }), 'X-Discarded')
    rerender(
      <AuthorizationDialog
        nodeId="http-node"
        payload={initialAuthorization}
        readOnly
        onChange={onSave}
      />,
    )
    await expectClosed()
    expect(screen.queryByRole('button', { name: triggerName })).not.toBeInTheDocument()
    expect(onSave).not.toHaveBeenCalled()

    rerender(
      <AuthorizationDialog
        nodeId="http-node"
        payload={initialAuthorization}
        readOnly={false}
        onChange={onSave}
      />,
    )
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: triggerName }))
    expect(screen.getByRole('textbox', { name: headerName })).toHaveValue('X-Original')
  })

  it('does not open for a read-only node', async () => {
    const user = userEvent.setup()
    const onSave = vi.fn()
    render(
      <AuthorizationDialog
        nodeId="http-node"
        payload={initialAuthorization}
        readOnly
        onChange={onSave}
      />,
    )

    expect(screen.queryByRole('button', { name: triggerName })).not.toBeInTheDocument()
    await user.click(
      screen.getByText('workflowIntegrations.nodes.http.authorization.authorization'),
    )
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    expect(onSave).not.toHaveBeenCalled()
  })
})
