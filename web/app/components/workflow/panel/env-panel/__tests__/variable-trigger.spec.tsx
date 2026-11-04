import type { ReactElement } from 'react'
import type { Shape } from '@/app/components/workflow/store/workflow'
import type { EnvironmentVariable } from '@/app/components/workflow/types'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import * as React from 'react'
import { WorkflowContext } from '@/app/components/workflow/context'
import { createWorkflowStore } from '@/app/components/workflow/store/workflow'
import VariableTrigger from '../variable-trigger'

vi.mock(
  '@/app/components/header/account-setting/model-provider-page/hooks',
  async (importOriginal) => {
    const actual =
      await importOriginal<
        typeof import('@/app/components/header/account-setting/model-provider-page/hooks')
      >()

    return {
      ...actual,
      useTextGenerationCurrentProviderAndModelAndModelList: () => ({
        activeTextGenerationModelList: [],
      }),
    }
  },
)

const createEnv = (overrides: Partial<EnvironmentVariable> = {}): EnvironmentVariable => ({
  id: 'env-1',
  name: 'api_key',
  value: '[__HIDDEN__]',
  value_type: 'secret',
  description: 'secret description',
  ...overrides,
})

const renderWithProviders = (
  ui: ReactElement,
  options: {
    storeState?: Partial<Shape>
  } = {},
) => {
  const store = createWorkflowStore({})

  if (options.storeState) store.setState(options.storeState)

  const result = render(<WorkflowContext value={store}>{ui}</WorkflowContext>)

  return {
    ...result,
    store,
  }
}

describe('VariableTrigger', () => {
  it('discards a cancelled secret edit before reopening and saving its replacement', async () => {
    const user = userEvent.setup()
    const onClose = vi.fn()
    const onSave = vi.fn()

    const TriggerHarness = () => {
      const [open, setOpen] = React.useState(false)

      return (
        <VariableTrigger
          open={open}
          setOpen={setOpen}
          env={createEnv({
            id: 'env-2',
            name: 'counter',
            value: '[__HIDDEN__]',
            description: 'editable',
          })}
          onClose={onClose}
          onSave={onSave}
        />
      )
    }

    renderWithProviders(<TriggerHarness />, {
      storeState: {
        environmentVariables: [createEnv({ id: 'env-2', name: 'counter' })],
        envSecrets: { 'env-2': '123' },
      },
    })

    await user.click(screen.getByRole('button', { name: 'workflow.env.envPanelButton' }))
    const firstInput = screen.getByPlaceholderText('workflow.env.modal.valuePlaceholder')
    await user.clear(firstInput)
    await user.type(firstInput, 'cancelled-secret')
    await user.keyboard('{Escape}')
    await waitFor(() =>
      expect(screen.queryByText('workflow.env.modal.editTitle')).not.toBeInTheDocument(),
    )
    expect(onSave).not.toHaveBeenCalled()
    await user.click(screen.getByRole('button', { name: 'workflow.env.envPanelButton' }))
    const valueInput = screen.getByPlaceholderText('workflow.env.modal.valuePlaceholder')
    expect(valueInput).toHaveValue('123')
    await user.clear(valueInput)
    await user.type(valueInput, '456')
    await user.click(screen.getByRole('button', { name: 'common.operation.save' }))

    expect(onSave).toHaveBeenCalledWith({
      id: 'env-2',
      name: 'counter',
      value: '456',
      value_type: 'secret',
      description: 'editable',
    })
    expect(onClose).toHaveBeenCalledTimes(2)
    expect(screen.queryByText('workflow.env.modal.editTitle')).not.toBeInTheDocument()
  })
})
