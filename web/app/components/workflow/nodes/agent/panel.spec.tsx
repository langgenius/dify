/**
 * Agent Panel - Enable Human Clarification Test
 *
 * Tests the enable_human_clarification onChange handler in the agent panel.
 * Covers panel.tsx line 114: setInputs({ ...inputs, enable_human_clarification: value })
 *
 * Strategy: Mock FormInputBoolean to capture and trigger its onChange callback directly,
 * avoiding dependency on component's internal text/UI.
 */

import type { AgentNodeType } from './types'
import { render } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import AgentPanel from './panel'

// Mock setInputs at the top level
const mockSetInputs = vi.fn()

// Capture FormInputBoolean's onChange callback
let capturedOnChange: ((value: boolean) => void) | null = null

// Mock useConfig to return minimal required data
vi.mock('./use-config', () => ({
  default: () => ({
    inputs: {
      enable_human_clarification: false,
      agent_strategy_name: 'test-strategy',
      agent_strategy_provider_name: 'test-provider',
      agent_strategy_label: 'Test Strategy',
      meta: { version: '1.0' },
      agent_parameters: {},
      output_schema: {},
      memory: undefined,
    },
    setInputs: mockSetInputs,
    currentStrategy: null,
    formData: {},
    onFormChange: vi.fn(),
    isChatMode: false,
    availableNodesWithParent: [],
    availableVars: [],
    readOnly: false,
    outputSchema: [],
    handleMemoryChange: vi.fn(),
  }),
}))

// Mock i18n
vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string) => key,
  }),
}))

// Mock store
vi.mock('../../store', () => ({
  useStore: (selector: (state: Record<string, unknown>) => unknown) => {
    const state = {
      setControlPromptEditorRerenderKey: vi.fn(),
    }
    return selector(state)
  },
}))

// Mock utility
vi.mock('@/utils/plugin-version-feature', () => ({
  isSupportMCP: () => true,
}))

// Mock heavy components
vi.mock('../_base/components/agent-strategy', () => ({
  AgentStrategy: () => <div />,
}))

vi.mock('../_base/components/mcp-tool-availability', () => ({
  MCPToolAvailabilityProvider: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}))

vi.mock('../_base/components/memory-config', () => ({
  default: () => <div />,
}))

vi.mock('../_base/components/output-vars', () => ({
  default: ({ children }: { children: React.ReactNode }) => <>{children}</>,
  VarItem: () => <div />,
}))

vi.mock('../_base/components/split', () => ({
  default: () => <div />,
}))

// Mock FormInputBoolean to capture onChange callback
vi.mock('../_base/components/form-input-boolean', () => ({
  default: ({ onChange }: { value: boolean; onChange: (value: boolean) => void }) => {
    capturedOnChange = onChange
    return <div data-testid="form-input-boolean" />
  },
}))

describe('AgentPanel - Enable Human Clarification', () => {
  beforeEach(() => {
    mockSetInputs.mockClear()
    capturedOnChange = null
  })

  it('should call setInputs with enable_human_clarification=true when onChange is triggered with true', () => {
    const mockData: AgentNodeType = {
      id: 'test-node',
      data: {},
    } as any

    render(
      <AgentPanel
        id="test-node"
        data={mockData}
      />,
    )

    // Trigger the captured onChange callback
    capturedOnChange?.(true)

    expect(mockSetInputs).toHaveBeenCalledWith(
      expect.objectContaining({
        enable_human_clarification: true,
      }),
    )
  })

  it('should call setInputs with enable_human_clarification=false when onChange is triggered with false', () => {
    const mockData: AgentNodeType = {
      id: 'test-node',
      data: {},
    } as any

    render(
      <AgentPanel
        id="test-node"
        data={mockData}
      />,
    )

    // Trigger the captured onChange callback
    capturedOnChange?.(false)

    expect(mockSetInputs).toHaveBeenCalledWith(
      expect.objectContaining({
        enable_human_clarification: false,
      }),
    )
  })

  it('should preserve other inputs when updating enable_human_clarification', () => {
    const mockData: AgentNodeType = {
      id: 'test-node',
      data: {},
    } as any

    render(
      <AgentPanel
        id="test-node"
        data={mockData}
      />,
    )

    // Trigger the captured onChange callback
    capturedOnChange?.(true)

    // Verify that spread operator preserves other inputs
    expect(mockSetInputs).toHaveBeenCalledWith(
      expect.objectContaining({
        agent_strategy_name: 'test-strategy',
        agent_strategy_provider_name: 'test-provider',
        agent_strategy_label: 'Test Strategy',
        enable_human_clarification: true,
      }),
    )
  })
})
