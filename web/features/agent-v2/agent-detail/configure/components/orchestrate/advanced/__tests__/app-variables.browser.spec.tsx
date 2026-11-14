import type { AgentSoulConfigFormState } from '@/features/agent-v2/agent-composer/form-state'
import { createInstance } from 'i18next'
import { useAtomValue } from 'jotai'
import { I18nextProvider } from 'react-i18next'
import { page, userEvent } from 'vite-plus/test/browser'
import { render } from 'vitest-browser-react'
import { formStateToAgentSoulConfig } from '@/features/agent-v2/agent-composer/conversions'
import { defaultAgentSoulConfigFormState } from '@/features/agent-v2/agent-composer/form-state'
import { AgentComposerProvider } from '@/features/agent-v2/agent-composer/provider'
import { agentComposerDraftAtom } from '@/features/agent-v2/agent-composer/store'
import agentV2 from '@/i18n/locales/en-US/agent-v-2.json'
import appDebug from '@/i18n/locales/en-US/app-debug.json'
import common from '@/i18n/locales/en-US/common.json'
import { AgentOrchestrateReadOnlyContext } from '../../read-only-context'
import { AgentAppVariablesEditor } from '../app-variables'

vi.unmock('react-i18next')

const savedConfigLabel = 'App variables the composer would save'

// The composer saves the draft through this conversion; showing its result lets a scenario
// assert what a publish would persist without reaching into component state.
function SavedAppVariables() {
  const formState = useAtomValue(agentComposerDraftAtom)

  return (
    <output aria-label={savedConfigLabel}>
      {JSON.stringify(formStateToAgentSoulConfig({ formState }).app_variables)}
    </output>
  )
}

async function setup({
  initialDraft = defaultAgentSoulConfigFormState,
  readOnly = false,
}: {
  initialDraft?: AgentSoulConfigFormState
  readOnly?: boolean
} = {}) {
  await page.viewport(1024, 768)
  const i18n = createInstance()
  await i18n.init({
    lng: 'en-US',
    resources: { 'en-US': { agentV2, appDebug, common } },
    keySeparator: false,
    interpolation: { escapeValue: false },
  })

  return render(
    <I18nextProvider i18n={i18n}>
      <AgentComposerProvider initialDraft={initialDraft}>
        <AgentOrchestrateReadOnlyContext value={readOnly}>
          <AgentAppVariablesEditor />
        </AgentOrchestrateReadOnlyContext>
        <SavedAppVariables />
      </AgentComposerProvider>
    </I18nextProvider>,
  )
}

const savedAppVariables = () => page.getByRole('status', { name: savedConfigLabel })

describe('AgentAppVariablesEditor', () => {
  it('declares a required variable and a select variable with typed options', async () => {
    await setup()

    await userEvent.type(page.getByRole('textbox', { name: 'Name' }), 'customer id')
    await expect.element(page.getByRole('textbox', { name: 'Name' })).toHaveValue('customer_id')
    await userEvent.click(page.getByRole('checkbox', { name: 'Required' }))

    await userEvent.click(page.getByRole('button', { name: 'Add app variable' }))
    const secondName = page.getByRole('textbox', { name: 'Name' }).nth(1)
    await expect.element(secondName).toHaveFocus()
    await userEvent.type(secondName, 'priority')

    await userEvent.click(page.getByRole('combobox', { name: 'Type' }).nth(1))
    await userEvent.click(page.getByRole('option', { name: 'Select' }))

    const options = page.getByRole('textbox', { name: 'Options' })
    await userEvent.type(options, 'low, high')
    await expect.element(options).toHaveValue('low, high')

    await expect.element(savedAppVariables()).toHaveTextContent(
      JSON.stringify([
        { name: 'customer_id', type: 'text-input', required: true, hide: false },
        {
          name: 'priority',
          type: 'select',
          required: false,
          hide: false,
          options: ['low', 'high'],
        },
      ]),
    )
  })

  it('saves an unchecked checkbox default as false instead of dropping it', async () => {
    await setup({
      initialDraft: {
        ...defaultAgentSoulConfigFormState,
        appVariables: [
          {
            id: 'vip',
            name: 'vip',
            type: 'checkbox',
            required: false,
            default: 'true',
            hide: false,
          },
        ],
      },
    })

    await userEvent.click(page.getByRole('checkbox', { name: 'Default' }))

    await expect
      .element(savedAppVariables())
      .toHaveTextContent(
        JSON.stringify([
          { name: 'vip', type: 'checkbox', required: false, hide: false, default: false },
        ]),
      )
  })

  it('does not accept a name the runtime would reject', async () => {
    await setup()

    const name = page.getByRole('textbox', { name: 'Name' })
    await userEvent.type(name, '1')

    await expect.element(name).toHaveValue('')
    await expect.element(savedAppVariables()).toHaveTextContent('[]')
  })

  it('shows declared variables without editing controls when read-only', async () => {
    await setup({
      readOnly: true,
      initialDraft: {
        ...defaultAgentSoulConfigFormState,
        appVariables: [
          {
            id: 'store',
            name: 'store',
            type: 'text-input',
            required: false,
            default: '',
            hide: true,
          },
        ],
      },
    })

    await expect.element(page.getByRole('cell', { name: 'store' })).toBeVisible()
    await expect.element(page.getByRole('textbox')).not.toBeInTheDocument()
    await expect
      .element(page.getByRole('button', { name: 'Add app variable' }))
      .not.toBeInTheDocument()
    await expect.element(page.getByRole('checkbox', { name: 'Hidden' })).toBeDisabled()
  })
})
