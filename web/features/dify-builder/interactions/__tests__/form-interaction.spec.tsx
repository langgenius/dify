import type { DifyBuilderActiveInteraction, FormField } from '../../types'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { DifyBuilderInteractionDock } from '../interaction-dock'

vi.mock('@/app/components/workflow/store', () => ({
  useStore: <T,>(selector: (state: { fileUploadConfig?: undefined }) => T) =>
    selector({ fileUploadConfig: undefined }),
}))

const renderForm = (
  variant: 'build_requirements' | 'edit_rules' | 'testdata',
  fields: FormField[],
  values?: Record<string, unknown>,
  frozen = false,
) => {
  const actionId =
    variant === 'build_requirements'
      ? 'submit_requirements'
      : variant === 'edit_rules'
        ? 'submit_edit_rules'
        : 'provide_testdata'
  const activeInteraction: DifyBuilderActiveInteraction = {
    action_id: actionId,
    card_seq: 0,
    valid_at_version: 1,
    card: { kind: 'form', seq: 0, at_version: 1, payload: { variant, fields, values, frozen } },
  }
  const submitInteraction = vi.fn(async () => true)
  render(
    <DifyBuilderInteractionDock
      activeInteraction={activeInteraction}
      busy={false}
      decision={null}
      interactionPending
      recheckReady={false}
      submitInteraction={submitInteraction}
    />,
  )
  const submit = screen.getByRole('button', {
    name:
      variant === 'testdata'
        ? 'difyBuilder.runTest'
        : variant === 'build_requirements'
          ? 'difyBuilder.copy.actions.submitRequirements'
          : 'difyBuilder.copy.actions.submitRules',
  })
  return { actionId, submit, submitInteraction }
}

it.each(['build_requirements', 'edit_rules', 'testdata'] as const)(
  'submits normalized defaults and prefilled values without editing a %s form',
  async (variant) => {
    const user = userEvent.setup()
    const { actionId, submit, submitInteraction } = renderForm(
      variant,
      [
        { key: 'topic', label: 'Topic', type: 'text', required: true, default: 'Default' },
        { key: 'settings', label: 'Settings', type: 'json_object', default: '{"limit":2}' },
        { key: 'enabled', label: 'Enabled', type: 'checkbox', default: true },
      ],
      { topic: 'Prefilled' },
    )

    await user.click(submit)

    const inputs = { topic: 'Prefilled', settings: { limit: 2 }, enabled: true }
    expect(submitInteraction).toHaveBeenCalledWith(
      actionId,
      variant === 'testdata' ? { mode: 'provide', inputs } : inputs,
      expect.any(Object),
    )
  },
)

it('keeps a frozen prefilled form from being submitted', async () => {
  const user = userEvent.setup()
  const { submit, submitInteraction } = renderForm(
    'testdata',
    [{ key: 'topic', label: 'Topic', type: 'text', required: true }],
    { topic: 'Frozen input' },
    true,
  )

  expect(screen.getByRole('textbox', { name: /Topic/ })).toBeDisabled()
  await user.click(submit)
  expect(submitInteraction).not.toHaveBeenCalled()
})

it('validates input and retries with the latest draft after a failed submission', async () => {
  const user = userEvent.setup()
  const { actionId, submit, submitInteraction } = renderForm(
    'edit_rules',
    [
      { key: 'topic', label: 'Topic', type: 'text', required: true },
      { key: 'audience', label: 'Audience', type: 'text' },
    ],
    { audience: 'Managers' },
  )
  submitInteraction.mockResolvedValueOnce(false)

  await user.click(submit)
  expect(submitInteraction).not.toHaveBeenCalled()
  expect(screen.getByRole('alert')).toHaveTextContent('difyBuilder.validation.fieldRequired')
  const topic = screen.getByRole('textbox', { name: /Topic/ })
  expect(topic).toHaveFocus()

  await user.type(topic, 'First attempt')
  await user.click(submit)
  expect(submitInteraction).toHaveBeenLastCalledWith(
    actionId,
    { topic: 'First attempt', audience: 'Managers' },
    expect.any(Object),
  )
  expect(topic).toHaveValue('First attempt')
  expect(topic).toBeEnabled()

  await user.clear(topic)
  await user.type(topic, 'Retry with new input')
  await user.clear(screen.getByRole('textbox', { name: 'Audience' }))
  await user.click(submit)
  expect(submitInteraction).toHaveBeenLastCalledWith(
    actionId,
    { topic: 'Retry with new input', audience: null },
    expect.any(Object),
  )
  expect(submitInteraction).toHaveBeenCalledTimes(2)
})
