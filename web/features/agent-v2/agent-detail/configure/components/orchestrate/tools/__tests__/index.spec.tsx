import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { AgentComposerProvider } from '@/features/agent-v2/agent-composer/provider'
import { defaultAgentSoulConfigFormState } from '@/features/agent-v2/agent-composer/store'
import { AgentTools } from '../index'

vi.mock('@/app/components/workflow/block-selector/tool-picker', () => ({
  ToolPickerContent: () => (
    <div>
      Mock tool picker
    </div>
  ),
}))

const agentToolsDraft = {
  ...defaultAgentSoulConfigFormState,
  tools: [
    {
      id: 'duckduckgo',
      kind: 'provider',
      name: 'DuckDuckGo',
      iconClassName: 'i-simple-icons-duckduckgo',
      credentialKey: 'agentDetail.configure.tools.credential.authOne',
      credentialVariant: 'authorized',
      actions: [
        {
          id: 'duckduckgo-search',
          name: 'DuckDuckGo Search',
          toolName: 'search',
          description: 'Search the web.',
        },
        {
          id: 'duckduckgo-image-search',
          name: 'DuckDuckGo Image Search',
          toolName: 'image_search',
          description: 'Search images.',
        },
      ],
    },
    {
      id: 'lark-cli',
      kind: 'cli',
      name: 'Lark CLI',
    },
  ],
} satisfies typeof defaultAgentSoulConfigFormState

function renderAgentTools() {
  return render(
    <AgentComposerProvider initialDraft={agentToolsDraft}>
      <AgentTools />
    </AgentComposerProvider>,
  )
}

describe('AgentTools', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  describe('User Interactions', () => {
    it('should remove a provider action when the remove button is clicked', async () => {
      const user = userEvent.setup()
      renderAgentTools()

      await user.click(screen.getByRole('button', {
        name: 'DuckDuckGo',
      }))

      await user.click(screen.getByRole('button', {
        name: 'agentV2.agentDetail.configure.tools.removeAction:{"name":"DuckDuckGo Image Search"}',
      }))

      expect(screen.queryByText('DuckDuckGo Image Search')).not.toBeInTheDocument()
      expect(screen.getByText('DuckDuckGo Search')).toBeInTheDocument()
      expect(screen.getByText('DuckDuckGo')).toBeInTheDocument()
    })

    it('should remove all provider tools from the provider more-actions menu', async () => {
      const user = userEvent.setup()
      renderAgentTools()

      await user.click(screen.getByRole('button', {
        name: 'agentV2.agentDetail.configure.tools.moreActions:{"name":"DuckDuckGo"}',
      }))
      await user.click(screen.getByRole('menuitem', {
        name: /agentV2\.agentDetail\.configure\.tools\.removeProvider/,
      }))

      expect(screen.queryByText('DuckDuckGo')).not.toBeInTheDocument()
      expect(screen.queryByText('DuckDuckGo Search')).not.toBeInTheDocument()
      expect(screen.getByText('Lark CLI')).toBeInTheDocument()
    })

    it('should keep the add trigger mounted while the tool picker is open', async () => {
      const user = userEvent.setup()
      renderAgentTools()

      await user.click(screen.getByRole('button', {
        name: 'agentV2.agentDetail.configure.tools.add',
      }))
      await user.click(screen.getByRole('button', {
        name: /agentV2\.agentDetail\.configure\.tools\.addMenu\.tool\.label/,
      }))

      expect(screen.getByText('Mock tool picker')).toBeInTheDocument()
      expect(screen.getByRole('button', {
        name: 'agentV2.agentDetail.configure.tools.add',
      })).toBeInTheDocument()
    })
  })
})
