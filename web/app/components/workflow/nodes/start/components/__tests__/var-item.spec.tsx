import type { InputVar } from '@/app/components/workflow/types'
import { screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { useState } from 'react'
import { InputVarType } from '@/app/components/workflow/types'
import { renderWorkflowEditor } from '@/test/workflow-editor'
import VarItem from '../var-item'

vi.mock('@/next/navigation', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/next/navigation')>()),
  useParams: () => ({ appId: 'app-1' }),
}))

const createPayload = (overrides: Partial<InputVar> = {}): InputVar => ({
  label: 'Query',
  variable: 'query',
  type: InputVarType.textInput,
  required: false,
  ...overrides,
})

function VarItemHarness() {
  const [payload, setPayload] = useState<InputVar | null>(() => createPayload())
  return (
    <>
      {payload && (
        <VarItem
          readonly={false}
          payload={payload}
          onChange={(next) => {
            setPayload(next)
            return true
          }}
          onRemove={() => setPayload(null)}
        />
      )}
      <output aria-label="Saved start variable">
        {payload ? JSON.stringify(payload) : 'removed'}
      </output>
    </>
  )
}

describe('StartVarItem', () => {
  it('opens and dismisses the prepopulated editor, then removes the variable from owner state', async () => {
    const user = userEvent.setup()
    renderWorkflowEditor(<VarItemHarness />)

    await user.hover(screen.getByText('query'))
    const edit = screen.getByRole('button', { name: 'common.operation.edit' })
    await user.click(edit)
    expect(
      screen.getByRole('dialog', { name: 'appDebug.variableConfig.editModalTitle' }),
    ).toBeInTheDocument()
    expect(screen.getByRole('textbox', { name: 'appDebug.variableConfig.varName' })).toHaveValue(
      'query',
    )
    expect(screen.getByRole('textbox', { name: 'appDebug.variableConfig.labelName' })).toHaveValue(
      'Query',
    )

    await user.click(screen.getByRole('button', { name: 'common.operation.cancel' }))
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
    expect(screen.getByRole('status', { name: 'Saved start variable' })).toHaveTextContent(
      JSON.stringify(createPayload()),
    )

    await user.hover(screen.getByText('query'))
    await user.click(screen.getByRole('button', { name: 'common.operation.remove' }))
    expect(screen.getByRole('status', { name: 'Saved start variable' })).toHaveTextContent(
      'removed',
    )
    expect(screen.queryByText('query')).not.toBeInTheDocument()
  })
})
