import type { AgentSoulConfigFormState } from '@/features/agent-v2/agent-composer/form-state'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { useAtomValue } from 'jotai'
import { beforeEach, describe, expect, it, vi } from 'vite-plus/test'
import { toast } from '@/app/notifications'
import { formStateToAgentSoulConfig } from '@/features/agent-v2/agent-composer/conversions'
import { defaultAgentSoulConfigFormState } from '@/features/agent-v2/agent-composer/form-state'
import { AgentComposerProvider } from '@/features/agent-v2/agent-composer/provider'
import { agentComposerDraftAtom } from '@/features/agent-v2/agent-composer/store'
import { AgentOrchestrateReadOnlyContext } from '../../read-only-context'
import { AgentAppVariablesEditor } from '../app-variables'

vi.mock('@/app/notifications', () => ({
  toast: {
    error: vi.fn(),
  },
}))

const mockToastError = vi.mocked(toast.error)

let latestDraft: AgentSoulConfigFormState = defaultAgentSoulConfigFormState

function DraftProbe() {
  latestDraft = useAtomValue(agentComposerDraftAtom)
  return null
}

const getSavedAppVariables = () =>
  formStateToAgentSoulConfig({ formState: latestDraft }).app_variables

function renderAppVariablesEditor(
  initialDraft: AgentSoulConfigFormState = defaultAgentSoulConfigFormState,
) {
  return render(
    <AgentComposerProvider initialDraft={initialDraft}>
      <AgentAppVariablesEditor />
      <DraftProbe />
    </AgentComposerProvider>,
  )
}

describe('AgentAppVariablesEditor', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    latestDraft = defaultAgentSoulConfigFormState
  })

  describe('User Interactions', () => {
    it('should declare a variable from the starter row', async () => {
      const user = userEvent.setup()
      renderAppVariablesEditor()

      await user.type(
        screen.getByRole('textbox', {
          name: 'agentV2.agentDetail.configure.advancedSettings.appVariablesEditor.nameColumn',
        }),
        'customer_id',
      )
      await user.click(
        screen.getByRole('checkbox', {
          name: 'agentV2.agentDetail.configure.advancedSettings.appVariablesEditor.requiredColumn',
        }),
      )

      expect(getSavedAppVariables()).toEqual([
        { name: 'customer_id', type: 'text-input', required: true, hide: false },
      ])
    })

    it('should keep separators while typing select options', async () => {
      const user = userEvent.setup()
      renderAppVariablesEditor({
        ...defaultAgentSoulConfigFormState,
        appVariables: [
          {
            id: 'priority',
            name: 'priority',
            type: 'select',
            required: false,
            default: '',
            hide: false,
            options: [],
          },
        ],
      })

      const optionsInput = screen.getByRole('textbox', {
        name: 'agentV2.agentDetail.configure.advancedSettings.appVariablesEditor.optionsColumn',
      })
      await user.type(optionsInput, 'low, high')

      expect(optionsInput).toHaveValue('low, high')
      expect(getSavedAppVariables()).toEqual([
        {
          name: 'priority',
          type: 'select',
          required: false,
          hide: false,
          options: ['low', 'high'],
        },
      ])
    })

    it('should reject variable names the runtime cannot accept', async () => {
      const user = userEvent.setup()
      renderAppVariablesEditor()

      await user.type(
        screen.getByRole('textbox', {
          name: 'agentV2.agentDetail.configure.advancedSettings.appVariablesEditor.nameColumn',
        }),
        '1',
      )

      expect(mockToastError).toHaveBeenCalledTimes(1)
      expect(getSavedAppVariables()).toEqual([])
    })
  })

  describe('Read-only', () => {
    it('should not offer editing controls when the configuration is read-only', () => {
      render(
        <AgentComposerProvider
          initialDraft={{
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
          }}
        >
          <AgentOrchestrateReadOnlyContext value>
            <AgentAppVariablesEditor />
          </AgentOrchestrateReadOnlyContext>
        </AgentComposerProvider>,
      )

      expect(screen.getByText('store')).toBeInTheDocument()
      expect(screen.queryByRole('textbox')).not.toBeInTheDocument()
      expect(
        screen.queryByRole('button', {
          name: 'agentV2.agentDetail.configure.advancedSettings.appVariablesEditor.add',
        }),
      ).not.toBeInTheDocument()
      expect(
        screen.getByRole('checkbox', {
          name: 'agentV2.agentDetail.configure.advancedSettings.appVariablesEditor.hiddenColumn',
        }),
      ).toHaveAttribute('aria-disabled', 'true')
    })
  })
})
