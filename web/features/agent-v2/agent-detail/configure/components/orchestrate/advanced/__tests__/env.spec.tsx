import { toast } from '@langgenius/dify-ui/toast'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { defaultAgentSoulConfigFormState } from '@/features/agent-v2/agent-composer/form-state'
import { AgentComposerProvider } from '@/features/agent-v2/agent-composer/provider'
import { AgentOrchestrateReadOnlyContext } from '../../read-only-context'
import { AgentEnvEditor, EnvVariablesTable } from '../env'
import { getEnvImportPlatform, parseEnvImport } from '../env-utils'

vi.mock('@langgenius/dify-ui/toast', () => ({
  toast: {
    error: vi.fn(),
  },
}))

const mockToastError = vi.mocked(toast.error)

function renderAgentEnvEditor() {
  return render(
    <AgentComposerProvider initialDraft={defaultAgentSoulConfigFormState}>
      <AgentEnvEditor />
    </AgentComposerProvider>,
  )
}

function renderReadonlyAgentEnvEditor() {
  return render(
    <AgentComposerProvider
      initialDraft={{
        ...defaultAgentSoulConfigFormState,
        envVariables: [
          {
            id: 'env-1',
            key: 'API_KEY',
            value: 'secret-value',
            scope: 'secret',
          },
        ],
      }}
    >
      <AgentOrchestrateReadOnlyContext value>
        <AgentEnvEditor />
      </AgentOrchestrateReadOnlyContext>
    </AgentComposerProvider>,
  )
}

describe('AgentEnvEditor', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  describe('Env parsing', () => {
    it('should report invalid dotenv lines without blocking valid entries', () => {
      expect(
        parseEnvImport(
          [
            '# ignored',
            'API_KEY=abc123',
            'INVALID_LINE',
            '=missing_key',
            'SECOND_KEY=enabled',
          ].join('\n'),
        ),
      ).toEqual({
        invalidLineCount: 2,
        variables: [
          { key: 'API_KEY', value: 'abc123' },
          { key: 'SECOND_KEY', value: 'enabled' },
        ],
      })
    })
  })

  describe('Platform Detection', () => {
    it('should detect the hidden-file help platform from browser values', () => {
      expect(getEnvImportPlatform({ platform: 'MacIntel' })).toBe('mac')
      expect(getEnvImportPlatform({ platform: 'Win32' })).toBe('windows')
      expect(getEnvImportPlatform({ userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)' })).toBe(
        'windows',
      )
      expect(getEnvImportPlatform({ platform: 'Linux x86_64' })).toBe('other')
    })
  })

  describe('User Interactions', () => {
    it('should edit the initial environment variable row directly', async () => {
      const user = userEvent.setup()
      renderAgentEnvEditor()

      const keyInput = screen.getByPlaceholderText(
        'agentV2.agentDetail.configure.advancedSettings.envEditor.keyPlaceholder',
      )
      const valueInput = screen.getByPlaceholderText(
        'agentV2.agentDetail.configure.advancedSettings.envEditor.valuePlaceholder',
      )

      await user.type(keyInput, 'API KEY')
      await user.type(valueInput, 'secret-value')

      expect(screen.getByDisplayValue('API_KEY')).toBeInTheDocument()
      expect(screen.getByDisplayValue('secret-value')).toBeInTheDocument()
    })

    it('should reject environment variable keys that do not match workflow variable rules', () => {
      renderAgentEnvEditor()

      const keyInput = screen.getByPlaceholderText(
        'agentV2.agentDetail.configure.advancedSettings.envEditor.keyPlaceholder',
      )

      fireEvent.change(keyInput, {
        target: { value: '1BAD' },
      })

      expect(keyInput).toHaveValue('')
      expect(mockToastError).toHaveBeenCalledWith(
        'appDebug.varKeyError.notStartWithNumber:{"key":"agentV2.agentDetail.configure.advancedSettings.envEditor.keyColumn"}',
      )
    })

    it('should add another editable variable row from the add button', async () => {
      const user = userEvent.setup()
      renderAgentEnvEditor()

      await user.click(
        screen.getByRole('button', {
          name: 'agentV2.agentDetail.configure.advancedSettings.envEditor.add',
        }),
      )

      const keyInputs = screen.getAllByPlaceholderText(
        'agentV2.agentDetail.configure.advancedSettings.envEditor.keyPlaceholder',
      )
      expect(keyInputs).toHaveLength(2)
      const newKeyInput = keyInputs[1]!
      expect(newKeyInput).toHaveFocus()

      await user.type(newKeyInput, 'SECOND_KEY')

      expect(screen.getByDisplayValue('SECOND_KEY')).toBeInTheDocument()
    })

    it('should import dotenv variables into the env table when a file is selected', async () => {
      const user = userEvent.setup()
      const { container } = renderAgentEnvEditor()
      const input = container.querySelector('input[type="file"]') as HTMLInputElement

      expect(input).not.toHaveAttribute('accept')

      const file = new File(
        ['API_KEY=abc123\n', 'export BASE_URL="https://example.com"\n'],
        '.env',
        { type: 'text/plain' },
      )

      await user.upload(input, file)

      await waitFor(() => {
        expect(screen.getByDisplayValue('API_KEY')).toBeInTheDocument()
      })
      expect(screen.getByDisplayValue('abc123')).toBeInTheDocument()
      expect(screen.getByDisplayValue('BASE_URL')).toBeInTheDocument()
      expect(screen.getByDisplayValue('https://example.com')).toBeInTheDocument()
    })

    it('should show a visible error when imported dotenv content includes invalid lines', async () => {
      const user = userEvent.setup()
      const { container } = renderAgentEnvEditor()
      const input = container.querySelector('input[type="file"]') as HTMLInputElement

      const file = new File(['API_KEY=abc123\n', 'INVALID_LINE\n', '=missing_key\n'], '.env', {
        type: 'text/plain',
      })

      await user.upload(input, file)

      await waitFor(() => {
        expect(screen.getByDisplayValue('API_KEY')).toBeInTheDocument()
      })
      expect(mockToastError).toHaveBeenCalledWith(
        'agentV2.agentDetail.configure.advancedSettings.envEditor.importSkippedInvalidLines:{"count":2}',
      )
    })

    it('should hide import, add, edit, and delete controls when readonly', () => {
      renderReadonlyAgentEnvEditor()

      expect(screen.getByText('API_KEY')).toBeInTheDocument()
      expect(screen.getByText('secret-value')).toBeInTheDocument()
      expect(
        screen.queryByRole('button', {
          name: 'agentV2.agentDetail.configure.advancedSettings.envEditor.importEnv',
        }),
      ).not.toBeInTheDocument()
      expect(
        screen.queryByRole('button', {
          name: 'agentV2.agentDetail.configure.advancedSettings.envEditor.add',
        }),
      ).not.toBeInTheDocument()
      expect(
        screen.queryByRole('button', {
          name: 'agentV2.agentDetail.configure.advancedSettings.envEditor.deleteVariable:{"key":"API_KEY"}',
        }),
      ).not.toBeInTheDocument()
      expect(screen.queryByDisplayValue('API_KEY')).not.toBeInTheDocument()
    })

    it('should reveal and hide masked variable values from the eye button', async () => {
      const user = userEvent.setup()

      render(
        <EnvVariablesTable
          editable
          envVariables={[
            {
              id: 'env-1',
              key: 'API_KEY',
              value: 'sk-original',
              scope: 'secret',
              masked: true,
            },
          ]}
          onDelete={vi.fn()}
          onScopeChange={vi.fn()}
          showDraftRow={false}
        />,
      )

      expect(screen.queryByDisplayValue('sk-original')).not.toBeInTheDocument()

      await user.click(
        screen.getByRole('button', {
          name: 'agentV2.agentDetail.configure.advancedSettings.envEditor.revealValue:{"key":"API_KEY"}',
        }),
      )

      expect(screen.getByDisplayValue('sk-original')).toBeInTheDocument()

      await user.click(
        screen.getByRole('button', {
          name: 'agentV2.agentDetail.configure.advancedSettings.envEditor.hideValue:{"key":"API_KEY"}',
        }),
      )

      expect(screen.queryByDisplayValue('sk-original')).not.toBeInTheDocument()
    })
  })
})
