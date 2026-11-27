import { useAtomValue } from 'jotai'
import { page, userEvent } from 'vite-plus/test/browser'
import { renderChatOwner } from '@/app/components/base/chat/chat/__tests__/chat-owner-preset'
import {
  agentSoulConfigToFormState,
  formStateToAgentSoulConfig,
} from '@/features/agent-v2/agent-composer/conversions'
import { defaultAgentSoulConfigFormState } from '@/features/agent-v2/agent-composer/form-state'
import { AgentComposerProvider } from '@/features/agent-v2/agent-composer/provider'
import { agentComposerDraftAtom } from '@/features/agent-v2/agent-composer/store'
import { ToolCallLimit } from '../call-limit'

vi.unmock('react-i18next')

function ConfiguredTool({ readOnly = false }: { readOnly?: boolean }) {
  const draft = useAtomValue(agentComposerDraftAtom)
  const tool = draft.tools[0]!
  if (tool.kind !== 'provider') throw new Error('Expected a provider')
  return (
    <div className="group flex w-100 items-center gap-1 p-4">
      <span>Search repositories</span>
      <ToolCallLimit action={tool.actions[0]!} toolId={tool.id} readOnly={readOnly} />
      <output aria-label="Saved configuration">
        {JSON.stringify(formStateToAgentSoulConfig({ formState: draft }).tools?.dify_tools)}
      </output>
    </div>
  )
}

const initialDraft = {
  ...defaultAgentSoulConfigFormState,
  tools: [
    {
      id: 'github',
      name: 'GitHub',
      kind: 'provider' as const,
      providerType: 'api' as const,
      iconClassName: '',
      credentialVariant: 'none' as const,
      actions: [{ id: 'search', name: 'Search repositories', toolName: 'search', description: '' }],
    },
  ],
}

it('commits only valid limits and remembers the last value across disabling and reopening', async () => {
  await renderChatOwner(
    <AgentComposerProvider initialDraft={initialDraft}>
      <ConfiguredTool />
    </AgentComposerProvider>,
  )
  const trigger = page.getByRole('button', { name: /Call limit for Search repositories/ })
  await trigger.click()
  const toggle = page.getByRole('switch', { name: 'Call limit per run' })
  const input = page.getByRole('textbox', { name: 'Maximum calls' })
  const saved = page.getByRole('status', { name: 'Saved configuration' })
  await expect.element(input).toBeDisabled()
  await toggle.click()
  await expect.element(input).toHaveValue('3')
  await expect.element(saved).toMatchTextContent('"max_calls_per_run":3')

  await input.fill('1.5')
  await userEvent.keyboard('{Enter}')
  await expect.element(page.getByText('Enter a whole number greater than 0.')).toBeVisible()
  await expect.element(input).toHaveValue('1.5')
  await expect.element(input).toHaveAttribute('aria-invalid', 'true')
  await expect.element(input).toHaveAccessibleDescription('Enter a whole number greater than 0.')
  await expect.element(saved).toMatchTextContent('"max_calls_per_run":3')
  await input.fill('0')
  await userEvent.keyboard('{Shift>}{Tab}{/Shift}')
  await expect.element(input).toHaveValue('0')
  await expect.element(saved).toMatchTextContent('"max_calls_per_run":3')
  await expect.element(page.getByText('Enter a whole number greater than 0.')).toBeVisible()
  await input.fill('5')
  await userEvent.keyboard('{Enter}')
  await expect.element(trigger).toHaveTextContent('5 calls / run')
  await expect
    .element(trigger)
    .toHaveAccessibleName('5 calls / run: Call limit for Search repositories')
  await expect.element(input).not.toHaveAttribute('aria-invalid', 'true')
  await expect
    .element(input)
    .not.toHaveAccessibleDescription('Enter a whole number greater than 0.')
  await page.getByRole('button', { name: 'Increase value' }).click()
  await expect.element(saved).toMatchTextContent('"max_calls_per_run":6')
  await page.getByRole('button', { name: 'Decrease value' }).click()
  await expect.element(saved).toMatchTextContent('"max_calls_per_run":5')
  await toggle.click()
  await expect.element(saved).toMatchTextContent('"max_calls_per_run":null')
  await expect.element(input).toHaveValue('5')
  await userEvent.keyboard('{Escape}')
  await expect.element(trigger).toHaveFocus()
  await userEvent.keyboard('{Enter}')
  await toggle.click()
  await expect.element(input).toHaveValue('5')
  await expect.element(saved).toMatchTextContent('"max_calls_per_run":5')
  await input.fill('')
  await userEvent.keyboard('{Shift>}{Tab}{/Shift}')
  await expect.element(page.getByText('Enter a whole number greater than 0.')).toBeVisible()
  await expect.element(saved).toMatchTextContent('"max_calls_per_run":5')
})

it('displays saved limits without an editing control in read-only versions', async () => {
  const draft = {
    ...initialDraft,
    tools: [
      {
        ...initialDraft.tools[0]!,
        actions: [{ ...initialDraft.tools[0]!.actions[0]!, maxCallsPerRun: 1 }],
      },
    ],
  }
  await renderChatOwner(
    <AgentComposerProvider initialDraft={draft}>
      <ConfiguredTool readOnly />
    </AgentComposerProvider>,
  )
  await expect.element(page.getByText('1 call / run', { exact: true })).toBeVisible()
  await expect
    .element(page.getByRole('button', { name: /Call limit for Search repositories/ }))
    .not.toBeInTheDocument()
})

it('restores the saved limit after disabling and loading a new editor session', async () => {
  const view = await renderChatOwner(
    <AgentComposerProvider initialDraft={initialDraft}>
      <ConfiguredTool />
    </AgentComposerProvider>,
  )
  await page.getByRole('button', { name: /Call limit for Search repositories/ }).click()
  await page.getByRole('switch', { name: 'Call limit per run' }).click()
  await page.getByRole('textbox', { name: 'Maximum calls' }).fill('7')
  await userEvent.keyboard('{Enter}')
  await page.getByRole('switch', { name: 'Call limit per run' }).click()
  const saved = page.getByRole('status', { name: 'Saved configuration' })
  await expect.element(saved).toMatchTextContent('"last_max_calls_per_run":7')
  const configuration = formStateToAgentSoulConfig({ formState: initialDraft })
  configuration.tools = { dify_tools: JSON.parse(saved.element().textContent!) }
  await view.unmount()
  await renderChatOwner(
    <AgentComposerProvider initialDraft={agentSoulConfigToFormState(configuration)}>
      <ConfiguredTool />
    </AgentComposerProvider>,
  )
  await page.getByRole('button', { name: /Call limit for search/ }).click()
  const input = page.getByRole('textbox', { name: 'Maximum calls' })
  await expect.element(input).toBeDisabled()
  await expect.element(input).toHaveValue('7')
  await page.getByRole('switch', { name: 'Call limit per run' }).click()
  await expect.element(input).toHaveValue('7')
  await expect.element(saved).toMatchTextContent('"max_calls_per_run":7')
})
