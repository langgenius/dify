import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { AgentComposerProvider } from '@/features/agent-v2/agent-composer/provider'
import { defaultAgentComposerDraft } from '@/features/agent-v2/agent-composer/store'
import { AgentEnvEditor } from '../env'
import { parseEnvVariables } from '../env-utils'

function renderAgentEnvEditor() {
  return render(
    <AgentComposerProvider initialDraft={defaultAgentComposerDraft}>
      <AgentEnvEditor />
    </AgentComposerProvider>,
  )
}

describe('AgentEnvEditor', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  describe('Env parsing', () => {
    it('should parse dotenv entries from supported line formats', () => {
      expect(parseEnvVariables([
        '# ignored',
        'API_KEY=abc123',
        'export BASE_URL="https://example.com"',
        'PASSWORD=secret # inline comment',
        'MULTILINE="first\\nsecond"',
        'INVALID_LINE',
      ].join('\n'))).toEqual([
        { key: 'API_KEY', value: 'abc123' },
        { key: 'BASE_URL', value: 'https://example.com' },
        { key: 'PASSWORD', value: 'secret' },
        { key: 'MULTILINE', value: 'first\nsecond' },
      ])
    })
  })

  describe('User Interactions', () => {
    it('should import dotenv variables into the env table when a file is selected', async () => {
      const user = userEvent.setup()
      renderAgentEnvEditor()

      const file = new File([
        'API_KEY=abc123\n',
        'export BASE_URL="https://example.com"\n',
      ], '.env', { type: 'text/plain' })

      await user.upload(
        screen.getByLabelText('agentV2.agentDetail.configure.advancedSettings.envEditor.importEnv'),
        file,
      )

      await waitFor(() => {
        expect(screen.getByDisplayValue('API_KEY')).toBeInTheDocument()
      })
      expect(screen.getByDisplayValue('abc123')).toBeInTheDocument()
      expect(screen.getByDisplayValue('BASE_URL')).toBeInTheDocument()
      expect(screen.getByDisplayValue('https://example.com')).toBeInTheDocument()
    })
  })
})
