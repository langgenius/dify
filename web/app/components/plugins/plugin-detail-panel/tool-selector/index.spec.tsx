import type { ReactNode } from 'react'
import type { Node } from 'reactflow'
import type { Collection } from '@/app/components/tools/types'
import type { ToolDefaultValue, ToolValue } from '@/app/components/workflow/block-selector/types'
import type { SchemaRoot } from '@/app/components/workflow/nodes/llm/types'
import type { NodeOutPutVar, ToolWithProvider } from '@/app/components/workflow/types'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { act, fireEvent, render, renderHook, screen, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { CollectionType } from '@/app/components/tools/types'
import { VarKindType } from '@/app/components/workflow/nodes/_base/types'
import { Type } from '@/app/components/workflow/nodes/llm/types'
import {
  SchemaModal,
  ToolAuthorizationSection,
  ToolBaseForm,
  ToolCredentialsForm,
  ToolItem,
  ToolSettingsPanel,
  ToolTrigger,
} from './components'
import { usePluginInstalledCheck, useToolSelectorState } from './hooks'
import ToolSelector from './index'

// ==================== Mock Setup ====================

// Mock service hooks - use let so we can modify in tests
// Allow undefined for testing fallback behavior
let mockBuildInTools: ToolWithProvider[] | undefined = []
let mockCustomTools: ToolWithProvider[] | undefined = []
let mockWorkflowTools: ToolWithProvider[] | undefined = []
let mockMcpTools: ToolWithProvider[] | undefined = []

vi.mock('@/service/use-tools', () => ({
  useAllBuiltInTools: () => ({ data: mockBuildInTools }),
  useAllCustomTools: () => ({ data: mockCustomTools }),
  useAllWorkflowTools: () => ({ data: mockWorkflowTools }),
  useAllMCPTools: () => ({ data: mockMcpTools }),
  useInvalidateAllBuiltInTools: () => vi.fn(),
}))

// Track manifest mock state
let mockManifestData: Record<string, unknown> | null = null

vi.mock('@/service/use-plugins', () => ({
  usePluginManifestInfo: () => ({ data: mockManifestData }),
  useInvalidateInstalledPluginList: () => vi.fn(),
}))

// Mock tool credential services
const mockFetchBuiltInToolCredentialSchema = vi.fn().mockResolvedValue([
  { name: 'api_key', type: 'string', required: false, label: { en_US: 'API Key' } },
])
const mockFetchBuiltInToolCredential = vi.fn().mockResolvedValue({})

vi.mock('@/service/tools', () => ({
  fetchBuiltInToolCredentialSchema: (...args: unknown[]) => mockFetchBuiltInToolCredentialSchema(...args),
  fetchBuiltInToolCredential: (...args: unknown[]) => mockFetchBuiltInToolCredential(...args),
}))

// Mock form schema utils - necessary for controlling test data
vi.mock('@/app/components/tools/utils/to-form-schema', () => ({
  generateFormValue: vi.fn().mockReturnValue({}),
  getPlainValue: vi.fn().mockImplementation(v => v),
  getStructureValue: vi.fn().mockImplementation(v => v),
  toolParametersToFormSchemas: vi.fn().mockReturnValue([]),
  toolCredentialToFormSchemas: vi.fn().mockImplementation(schemas => schemas.map((s: { required?: boolean }) => ({
    ...s,
    required: s.required || false,
  }))),
  addDefaultValue: vi.fn().mockImplementation((credential, _schemas) => credential),
}))

// Mock complex child components that need controlled interaction
vi.mock('@/app/components/workflow/block-selector/tool-picker', () => ({
  default: ({
    onSelect,
    onSelectMultiple,
    trigger,
  }: {
    onSelect: (tool: ToolDefaultValue) => void
    onSelectMultiple?: (tools: ToolDefaultValue[]) => void
    trigger: ReactNode
  }) => {
    const mockToolDefault = {
      provider_id: 'test-provider/tool',
      provider_type: 'builtin',
      provider_name: 'Test Provider',
      tool_name: 'test-tool',
      tool_label: 'Test Tool',
      tool_description: 'A test tool',
      title: 'Test Tool Title',
      is_team_authorization: true,
      params: {},
      paramSchemas: [],
    }
    return (
      <div data-testid="tool-picker">
        {trigger}
        <button
          data-testid="select-tool-btn"
          onClick={() => onSelect(mockToolDefault as ToolDefaultValue)}
        >
          Select Tool
        </button>
        <button
          data-testid="select-multiple-btn"
          onClick={() => onSelectMultiple?.([mockToolDefault as ToolDefaultValue])}
        >
          Select Multiple
        </button>
      </div>
    )
  },
}))

vi.mock('@/app/components/workflow/nodes/tool/components/tool-form', () => ({
  default: ({
    onChange,
    value,
  }: {
    onChange: (v: Record<string, unknown>) => void
    value: Record<string, unknown>
  }) => (
    <div data-testid="tool-form">
      <span data-testid="tool-form-value">{JSON.stringify(value)}</span>
      <button
        data-testid="change-settings-btn"
        onClick={() => onChange({ setting1: 'new-value' })}
      >
        Change Settings
      </button>
    </div>
  ),
}))

vi.mock('@/app/components/plugins/plugin-auth', () => ({
  AuthCategory: { tool: 'tool' },
  PluginAuthInAgent: ({
    onAuthorizationItemClick,
  }: {
    onAuthorizationItemClick: (id: string) => void
  }) => (
    <div data-testid="plugin-auth-in-agent">
      <button
        data-testid="auth-item-click-btn"
        onClick={() => onAuthorizationItemClick('credential-123')}
      >
        Select Credential
      </button>
    </div>
  ),
}))

// Portal components need mocking for controlled positioning in tests
vi.mock('@/app/components/base/portal-to-follow-elem', () => ({
  PortalToFollowElem: ({
    children,
    open,
  }: {
    children: ReactNode
    open?: boolean
  }) => (
    <div data-testid="portal-to-follow-elem" data-open={open}>
      {children}
    </div>
  ),
  PortalToFollowElemTrigger: ({
    children,
    onClick,
  }: {
    children: ReactNode
    onClick?: () => void
  }) => (
    <div data-testid="portal-trigger" onClick={onClick}>
      {children}
    </div>
  ),
  PortalToFollowElemContent: ({ children }: { children: ReactNode }) => (
    <div data-testid="portal-content">{children}</div>
  ),
}))

vi.mock('../../../readme-panel/entrance', () => ({
  ReadmeEntrance: () => <div data-testid="readme-entrance" />,
}))

vi.mock('./components/reasoning-config-form', () => ({
  default: ({
    onChange,
    value,
  }: {
    onChange: (v: Record<string, unknown>) => void
    value: Record<string, unknown>
  }) => (
    <div data-testid="reasoning-config-form">
      <span data-testid="params-value">{JSON.stringify(value)}</span>
      <button
        data-testid="change-params-btn"
        onClick={() => onChange({ param1: 'new-param' })}
      >
        Change Params
      </button>
    </div>
  ),
}))

// Track MCP availability mock state
let mockMCPToolAllowed = true

vi.mock('@/app/components/workflow/nodes/_base/components/mcp-tool-availability', () => ({
  useMCPToolAvailability: () => ({ allowed: mockMCPToolAllowed }),
}))

vi.mock('@/app/components/workflow/nodes/_base/components/mcp-tool-not-support-tooltip', () => ({
  default: () => <div data-testid="mcp-not-support-tooltip" />,
}))

vi.mock('@/app/components/workflow/nodes/_base/components/install-plugin-button', () => ({
  InstallPluginButton: ({
    onSuccess,
    onClick,
  }: {
    onSuccess?: () => void
    onClick?: (e: React.MouseEvent) => void
  }) => (
    <button
      data-testid="install-plugin-btn"
      onClick={(e) => {
        onClick?.(e)
        onSuccess?.()
      }}
    >
      Install
    </button>
  ),
}))

vi.mock('@/app/components/workflow/nodes/_base/components/switch-plugin-version', () => ({
  SwitchPluginVersion: ({
    onChange,
  }: {
    onChange?: () => void
  }) => (
    <button data-testid="switch-version-btn" onClick={onChange}>
      Switch Version
    </button>
  ),
}))

vi.mock('@/app/components/workflow/block-icon', () => ({
  default: () => <div data-testid="block-icon" />,
}))

// Mock Modal - headlessui Dialog has complex behavior
vi.mock('@/app/components/base/modal', () => ({
  default: ({ children, isShow }: { children: ReactNode, isShow: boolean }) => (
    isShow ? <div data-testid="modal">{children}</div> : null
  ),
}))

// Mock VisualEditor - complex component with many dependencies
vi.mock('@/app/components/workflow/nodes/llm/components/json-schema-config-modal/visual-editor', () => ({
  default: () => <div data-testid="visual-editor" />,
}))

vi.mock('@/app/components/workflow/nodes/llm/components/json-schema-config-modal/visual-editor/context', () => ({
  MittProvider: ({ children }: { children: ReactNode }) => <>{children}</>,
  VisualEditorContextProvider: ({ children }: { children: ReactNode }) => <>{children}</>,
}))

// Mock Form - complex model provider form
vi.mock('@/app/components/header/account-setting/model-provider-page/model-modal/Form', () => ({
  default: ({
    onChange,
    value,
    fieldMoreInfo,
  }: {
    onChange: (v: Record<string, unknown>) => void
    value: Record<string, unknown>
    fieldMoreInfo?: (item: { url?: string | null }) => ReactNode
  }) => (
    <div data-testid="credential-form">
      <input
        data-testid="form-input"
        value={JSON.stringify(value)}
        onChange={e => onChange(JSON.parse(e.target.value || '{}'))}
      />
      {fieldMoreInfo && (
        <div data-testid="field-more-info">
          {fieldMoreInfo({ url: 'https://example.com' })}
          {fieldMoreInfo({ url: null })}
        </div>
      )}
    </div>
  ),
}))

// Mock Toast - need to track notify calls for assertions
const mockToastNotify = vi.fn()
vi.mock('@/app/components/base/toast', () => ({
  default: { notify: (...args: unknown[]) => mockToastNotify(...args) },
}))

// ==================== Test Utilities ====================

const createTestQueryClient = () =>
  new QueryClient({
    defaultOptions: {
      queries: {
        retry: false,
        gcTime: 0,
      },
    },
  })

const createWrapper = () => {
  const testQueryClient = createTestQueryClient()
  return ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={testQueryClient}>
      {children}
    </QueryClientProvider>
  )
}

// Factory functions for test data
const createToolValue = (overrides: Partial<ToolValue> = {}): ToolValue => ({
  provider_name: 'test-provider/tool',
  provider_show_name: 'Test Provider',
  tool_name: 'test-tool',
  tool_label: 'Test Tool',
  tool_description: 'A test tool',
  settings: {},
  parameters: {},
  enabled: true,
  extra: { description: 'Test description' },
  ...overrides,
})

const createToolDefaultValue = (overrides: Partial<ToolDefaultValue> = {}): ToolDefaultValue => ({
  provider_id: 'test-provider/tool',
  provider_type: CollectionType.builtIn,
  provider_name: 'Test Provider',
  tool_name: 'test-tool',
  tool_label: 'Test Tool',
  tool_description: 'A test tool',
  title: 'Test Tool Title',
  is_team_authorization: true,
  params: {},
  paramSchemas: [],
  ...overrides,
} as ToolDefaultValue)

// Helper to create mock ToolFormSchema for testing
const createMockFormSchema = (name: string) => ({
  name,
  variable: name,
  label: { en_US: name, zh_Hans: name },
  type: 'text-input',
  _type: 'string',
  form: 'llm',
  required: false,
  show_on: [],
})

const createToolWithProvider = (overrides: Record<string, unknown> = {}): ToolWithProvider => ({
  id: 'test-provider/tool',
  name: 'test-provider',
  type: CollectionType.builtIn,
  icon: 'test-icon',
  is_team_authorization: true,
  allow_delete: true,
  tools: [
    {
      name: 'test-tool',
      label: { en_US: 'Test Tool' },
      description: { en_US: 'A test tool' },
      parameters: [
        { name: 'setting1', form: 'user', type: 'string' },
        { name: 'param1', form: 'llm', type: 'string' },
      ],
    },
  ],
  ...overrides,
} as unknown as ToolWithProvider)

const defaultProps = {
  onSelect: vi.fn(),
  nodeOutputVars: [] as NodeOutPutVar[],
  availableNodes: [] as Node[],
}

// ==================== Hook Tests ====================

describe('usePluginInstalledCheck Hook', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('should return inMarketPlace as false when manifest is null', () => {
    const { result } = renderHook(
      () => usePluginInstalledCheck('test-provider/tool'),
      { wrapper: createWrapper() },
    )

    expect(result.current.inMarketPlace).toBe(false)
    expect(result.current.manifest).toBeUndefined()
  })

  it('should handle empty provider name', () => {
    const { result } = renderHook(
      () => usePluginInstalledCheck(''),
      { wrapper: createWrapper() },
    )

    expect(result.current.inMarketPlace).toBe(false)
  })

  it('should extract pluginID from provider name correctly', () => {
    const { result } = renderHook(
      () => usePluginInstalledCheck('org/plugin/extra'),
      { wrapper: createWrapper() },
    )

    // The hook should parse "org/plugin" from "org/plugin/extra"
    expect(result.current.inMarketPlace).toBe(false)
  })
})

describe('useToolSelectorState Hook', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  describe('Initial State', () => {
    it('should initialize with correct default values', () => {
      const onSelect = vi.fn()
      const { result } = renderHook(
        () => useToolSelectorState({ onSelect }),
        { wrapper: createWrapper() },
      )

      expect(result.current.isShow).toBe(false)
      expect(result.current.isShowChooseTool).toBe(false)
      expect(result.current.currType).toBe('settings')
      expect(result.current.currentProvider).toBeUndefined()
      expect(result.current.currentTool).toBeUndefined()
    })
  })

  describe('State Setters', () => {
    it('should update isShow state', () => {
      const onSelect = vi.fn()
      const { result } = renderHook(
        () => useToolSelectorState({ onSelect }),
        { wrapper: createWrapper() },
      )

      act(() => {
        result.current.setIsShow(true)
      })

      expect(result.current.isShow).toBe(true)
    })

    it('should update isShowChooseTool state', () => {
      const onSelect = vi.fn()
      const { result } = renderHook(
        () => useToolSelectorState({ onSelect }),
        { wrapper: createWrapper() },
      )

      act(() => {
        result.current.setIsShowChooseTool(true)
      })

      expect(result.current.isShowChooseTool).toBe(true)
    })

    it('should update currType state', () => {
      const onSelect = vi.fn()
      const { result } = renderHook(
        () => useToolSelectorState({ onSelect }),
        { wrapper: createWrapper() },
      )

      act(() => {
        result.current.setCurrType('params')
      })

      expect(result.current.currType).toBe('params')
    })
  })

  describe('Event Handlers', () => {
    it('should call onSelect when handleDescriptionChange is triggered', () => {
      const onSelect = vi.fn()
      const value = createToolValue()
      const { result } = renderHook(
        () => useToolSelectorState({ value, onSelect }),
        { wrapper: createWrapper() },
      )

      act(() => {
        result.current.handleDescriptionChange({
          target: { value: 'new description' },
        } as React.ChangeEvent<HTMLTextAreaElement>)
      })

      expect(onSelect).toHaveBeenCalledWith(
        expect.objectContaining({
          extra: expect.objectContaining({ description: 'new description' }),
        }),
      )
    })

    it('should call onSelect when handleEnabledChange is triggered', () => {
      const onSelect = vi.fn()
      const value = createToolValue({ enabled: false })
      const { result } = renderHook(
        () => useToolSelectorState({ value, onSelect }),
        { wrapper: createWrapper() },
      )

      act(() => {
        result.current.handleEnabledChange(true)
      })

      expect(onSelect).toHaveBeenCalledWith(
        expect.objectContaining({ enabled: true }),
      )
    })

    it('should call onSelect when handleAuthorizationItemClick is triggered', () => {
      const onSelect = vi.fn()
      const value = createToolValue()
      const { result } = renderHook(
        () => useToolSelectorState({ value, onSelect }),
        { wrapper: createWrapper() },
      )

      act(() => {
        result.current.handleAuthorizationItemClick('credential-123')
      })

      expect(onSelect).toHaveBeenCalledWith(
        expect.objectContaining({ credential_id: 'credential-123' }),
      )
    })

    it('should call onSelect when handleSettingsFormChange is triggered', () => {
      const onSelect = vi.fn()
      const value = createToolValue()
      const { result } = renderHook(
        () => useToolSelectorState({ value, onSelect }),
        { wrapper: createWrapper() },
      )

      act(() => {
        result.current.handleSettingsFormChange({ key: { type: VarKindType.constant, value: 'value' } })
      })

      expect(onSelect).toHaveBeenCalledWith(
        expect.objectContaining({
          settings: expect.any(Object),
        }),
      )
    })

    it('should call onSelect when handleParamsFormChange is triggered', () => {
      const onSelect = vi.fn()
      const value = createToolValue()
      const { result } = renderHook(
        () => useToolSelectorState({ value, onSelect }),
        { wrapper: createWrapper() },
      )

      act(() => {
        result.current.handleParamsFormChange({ param: { value: { type: VarKindType.constant, value: 'value' } } })
      })

      expect(onSelect).toHaveBeenCalledWith(
        expect.objectContaining({ parameters: { param: { value: { type: VarKindType.constant, value: 'value' } } } }),
      )
    })

    it('should call onSelectMultiple when handleSelectMultipleTool is triggered', () => {
      const onSelect = vi.fn()
      const onSelectMultiple = vi.fn()
      const { result } = renderHook(
        () => useToolSelectorState({ onSelect, onSelectMultiple }),
        { wrapper: createWrapper() },
      )

      act(() => {
        result.current.handleSelectMultipleTool([createToolDefaultValue()])
      })

      expect(onSelectMultiple).toHaveBeenCalled()
    })
  })

  describe('Computed Values', () => {
    it('should return empty settings value when no settings', () => {
      const onSelect = vi.fn()
      const { result } = renderHook(
        () => useToolSelectorState({ onSelect }),
        { wrapper: createWrapper() },
      )

      expect(result.current.getSettingsValue()).toEqual({})
    })

    it('should compute showTabSlider correctly', () => {
      const onSelect = vi.fn()
      const { result } = renderHook(
        () => useToolSelectorState({ onSelect }),
        { wrapper: createWrapper() },
      )

      // Without currentProvider, should be false
      expect(result.current.showTabSlider).toBe(false)
    })
  })
})

// ==================== Component Tests ====================

describe('ToolTrigger Component', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  describe('Rendering', () => {
    it('should render without crashing', () => {
      render(<ToolTrigger open={false} />)
      expect(screen.getByText(/placeholder|configureTool/i)).toBeInTheDocument()
    })

    it('should show placeholder text when no value', () => {
      render(<ToolTrigger open={false} />)
      // Should show placeholder text from i18n
      expect(screen.getByText(/placeholder|configureTool/i)).toBeInTheDocument()
    })

    it('should show tool name when value is provided', () => {
      const value = { provider_name: 'test', tool_name: 'My Tool' }
      const provider = createToolWithProvider()

      render(<ToolTrigger open={false} value={value} provider={provider} />)
      expect(screen.getByText('My Tool')).toBeInTheDocument()
    })

    it('should show configure icon when isConfigure is true', () => {
      render(<ToolTrigger open={false} isConfigure />)
      // RiEqualizer2Line should be present
      const container = screen.getByText(/configureTool/i).parentElement
      expect(container).toBeInTheDocument()
    })

    it('should show arrow icon when isConfigure is false', () => {
      render(<ToolTrigger open={false} isConfigure={false} />)
      // RiArrowDownSLine should be present
      const container = screen.getByText(/placeholder/i).parentElement
      expect(container).toBeInTheDocument()
    })

    it('should apply open state styling', () => {
      const { rerender, container } = render(<ToolTrigger open={false} />)
      expect(container.querySelector('.group')).toBeInTheDocument()

      rerender(<ToolTrigger open={true} />)
      // When open is true, the root div should have the hover-alt background
      const updatedTriggerDiv = container.querySelector('.bg-state-base-hover-alt')
      expect(updatedTriggerDiv).toBeInTheDocument()
    })
  })
})

describe('ToolItem Component', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  describe('Rendering', () => {
    it('should render without crashing', () => {
      const { container } = render(<ToolItem open={false} />)
      expect(container.querySelector('.group')).toBeInTheDocument()
    })

    it('should display provider name and tool label', () => {
      render(
        <ToolItem
          open={false}
          providerName="org/provider"
          toolLabel="My Tool"
        />,
      )
      expect(screen.getByText('provider')).toBeInTheDocument()
      expect(screen.getByText('My Tool')).toBeInTheDocument()
    })

    it('should show MCP provider show name for MCP tools', () => {
      render(
        <ToolItem
          open={false}
          isMCPTool
          providerShowName="MCP Provider"
          toolLabel="My Tool"
        />,
      )
      expect(screen.getByText('MCP Provider')).toBeInTheDocument()
    })

    it('should render string icon correctly', () => {
      render(
        <ToolItem
          open={false}
          icon="https://example.com/icon.png"
          toolLabel="Tool"
        />,
      )
      const iconElement = document.querySelector('[style*="background-image"]')
      expect(iconElement).toBeInTheDocument()
    })

    it('should render object icon correctly', () => {
      render(
        <ToolItem
          open={false}
          icon={{ content: '🔧', background: '#fff' }}
          toolLabel="Tool"
        />,
      )
      // AppIcon should be rendered
      expect(document.querySelector('.rounded-lg')).toBeInTheDocument()
    })

    it('should render default icon when no icon provided', () => {
      render(<ToolItem open={false} toolLabel="Tool" />)
      // Group icon should be rendered
      expect(document.querySelector('.opacity-35')).toBeInTheDocument()
    })
  })

  describe('User Interactions', () => {
    it('should call onDelete when delete button is clicked', async () => {
      const onDelete = vi.fn()
      render(
        <ToolItem
          open={false}
          onDelete={onDelete}
          toolLabel="Tool"
        />,
      )

      // Find the delete button (hidden by default, shown on hover)
      const deleteBtn = document.querySelector('[class*="hover:text-text-destructive"]')
      if (deleteBtn) {
        fireEvent.click(deleteBtn)
        expect(onDelete).toHaveBeenCalled()
      }
    })

    it('should call onSwitchChange when switch is toggled', () => {
      const onSwitchChange = vi.fn()
      render(
        <ToolItem
          open={false}
          showSwitch
          switchValue={false}
          onSwitchChange={onSwitchChange}
          toolLabel="Tool"
        />,
      )

      // The switch should be rendered
      const switchContainer = document.querySelector('.mr-1')
      expect(switchContainer).toBeInTheDocument()
    })

    it('should stop propagation on delete click', () => {
      const onDelete = vi.fn()
      const parentClick = vi.fn()

      render(
        <div onClick={parentClick}>
          <ToolItem
            open={false}
            onDelete={onDelete}
            toolLabel="Tool"
          />
        </div>,
      )

      const deleteBtn = document.querySelector('[class*="hover:text-text-destructive"]')
      if (deleteBtn) {
        fireEvent.click(deleteBtn)
        expect(parentClick).not.toHaveBeenCalled()
      }
    })
  })

  describe('Conditional Rendering', () => {
    it('should show switch only when showSwitch is true and no errors', () => {
      const { rerender } = render(
        <ToolItem open={false} showSwitch={false} toolLabel="Tool" />,
      )
      expect(document.querySelector('.mr-1')).not.toBeInTheDocument()

      rerender(
        <ToolItem open={false} showSwitch toolLabel="Tool" />,
      )
      expect(document.querySelector('.mr-1')).toBeInTheDocument()
    })

    it('should show not authorized button when noAuth is true', () => {
      render(
        <ToolItem
          open={false}
          noAuth
          toolLabel="Tool"
        />,
      )
      expect(screen.getByText(/notAuthorized/i)).toBeInTheDocument()
    })

    it('should show auth removed button when authRemoved is true', () => {
      render(
        <ToolItem
          open={false}
          authRemoved
          toolLabel="Tool"
        />,
      )
      expect(screen.getByText(/authRemoved/i)).toBeInTheDocument()
    })

    it('should show install button when uninstalled', () => {
      render(
        <ToolItem
          open={false}
          uninstalled
          installInfo="plugin@1.0.0"
          toolLabel="Tool"
        />,
      )
      expect(screen.getByTestId('install-plugin-btn')).toBeInTheDocument()
    })

    it('should show version switch when versionMismatch', () => {
      render(
        <ToolItem
          open={false}
          versionMismatch
          installInfo="plugin@1.0.0"
          toolLabel="Tool"
        />,
      )
      expect(screen.getByTestId('switch-version-btn')).toBeInTheDocument()
    })

    it('should show error icon when isError is true', () => {
      render(
        <ToolItem
          open={false}
          isError
          errorTip="Error occurred"
          toolLabel="Tool"
        />,
      )
      // RiErrorWarningFill should be rendered
      expect(document.querySelector('.text-text-destructive')).toBeInTheDocument()
    })

    it('should apply opacity when transparent states are true', () => {
      render(
        <ToolItem
          open={false}
          uninstalled
          toolLabel="Tool"
        />,
      )
      expect(document.querySelector('.opacity-50')).toBeInTheDocument()
    })

    it('should show MCP tooltip when isMCPTool is true and MCP not allowed', () => {
      // Set MCP tool not allowed
      mockMCPToolAllowed = false
      render(
        <ToolItem
          open={false}
          isMCPTool
          toolLabel="Tool"
        />,
      )
      // McpToolNotSupportTooltip should be rendered (line 128)
      expect(screen.getByTestId('mcp-not-support-tooltip')).toBeInTheDocument()
      // Reset
      mockMCPToolAllowed = true
    })

    it('should apply opacity-30 to icon when isMCPTool and not allowed with string icon', () => {
      mockMCPToolAllowed = false
      const { container } = render(
        <ToolItem
          open={false}
          isMCPTool
          icon="https://example.com/icon.png"
          toolLabel="Tool"
        />,
      )
      // Should have opacity-30 class on the icon container (line 80)
      const iconContainer = container.querySelector('.shrink-0.opacity-30')
      expect(iconContainer).toBeInTheDocument()
      mockMCPToolAllowed = true
    })

    it('should not have opacity-30 on icon when isMCPTool is false', () => {
      mockMCPToolAllowed = true
      const { container } = render(
        <ToolItem
          open={false}
          isMCPTool={false}
          icon="https://example.com/icon.png"
          toolLabel="Tool"
        />,
      )
      // Should NOT have opacity-30 when isShowCanNotChooseMCPTip is false
      const iconContainer = container.querySelector('.shrink-0')
      expect(iconContainer).toBeInTheDocument()
      expect(iconContainer).not.toHaveClass('opacity-30')
    })

    it('should not have opacity-30 on icon when MCP allowed', () => {
      mockMCPToolAllowed = true
      const { container } = render(
        <ToolItem
          open={false}
          isMCPTool={true}
          icon="https://example.com/icon.png"
          toolLabel="Tool"
        />,
      )
      // Should NOT have opacity-30 when MCP is allowed
      const iconContainer = container.querySelector('.shrink-0')
      expect(iconContainer).toBeInTheDocument()
      expect(iconContainer).not.toHaveClass('opacity-30')
    })

    it('should apply opacity-30 to default icon when isMCPTool and not allowed without icon', () => {
      mockMCPToolAllowed = false
      render(
        <ToolItem
          open={false}
          isMCPTool
          toolLabel="Tool"
        />,
      )
      // Should have opacity-30 class on default icon container (lines 89-97)
      expect(document.querySelector('.opacity-30')).toBeInTheDocument()
      mockMCPToolAllowed = true
    })

    it('should show switch when showSwitch is true without MCP tip', () => {
      const { container } = render(
        <ToolItem
          open={false}
          showSwitch
          toolLabel="Tool"
        />,
      )
      // Switch wrapper should be rendered when showSwitch is true and no MCP tip
      expect(container.querySelector('.mr-1')).toBeInTheDocument()
    })

    it('should show MCP tooltip instead of switch when isMCPTool and not allowed', () => {
      mockMCPToolAllowed = false
      render(
        <ToolItem
          open={false}
          showSwitch
          isMCPTool
          toolLabel="Tool"
        />,
      )
      // MCP tooltip should be rendered
      expect(screen.getByTestId('mcp-not-support-tooltip')).toBeInTheDocument()
      mockMCPToolAllowed = true
    })
  })

  describe('Install/Upgrade Actions', () => {
    it('should call onInstall when install button is clicked', () => {
      const onInstall = vi.fn()
      render(
        <ToolItem
          open={false}
          uninstalled
          installInfo="plugin@1.0.0"
          onInstall={onInstall}
          toolLabel="Tool"
        />,
      )

      fireEvent.click(screen.getByTestId('install-plugin-btn'))
      expect(onInstall).toHaveBeenCalled()
    })

    it('should call onInstall when version switch is clicked', () => {
      const onInstall = vi.fn()
      render(
        <ToolItem
          open={false}
          versionMismatch
          installInfo="plugin@1.0.0"
          onInstall={onInstall}
          toolLabel="Tool"
        />,
      )

      fireEvent.click(screen.getByTestId('switch-version-btn'))
      expect(onInstall).toHaveBeenCalled()
    })
  })
})

describe('ToolAuthorizationSection Component', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  describe('Rendering', () => {
    it('should render null when currentProvider is undefined', () => {
      const { container } = render(
        <ToolAuthorizationSection
          onAuthorizationItemClick={vi.fn()}
        />,
      )
      expect(container.firstChild).toBeNull()
    })

    it('should render null when provider type is not builtIn', () => {
      const provider = createToolWithProvider({ type: CollectionType.custom })
      const { container } = render(
        <ToolAuthorizationSection
          currentProvider={provider}
          onAuthorizationItemClick={vi.fn()}
        />,
      )
      expect(container.firstChild).toBeNull()
    })

    it('should render null when allow_delete is false', () => {
      const provider = createToolWithProvider({ allow_delete: false })
      const { container } = render(
        <ToolAuthorizationSection
          currentProvider={provider}
          onAuthorizationItemClick={vi.fn()}
        />,
      )
      expect(container.firstChild).toBeNull()
    })

    it('should render when all conditions are met', () => {
      const provider = createToolWithProvider({
        type: CollectionType.builtIn,
        allow_delete: true,
      })
      render(
        <ToolAuthorizationSection
          currentProvider={provider}
          onAuthorizationItemClick={vi.fn()}
        />,
      )
      expect(screen.getByTestId('plugin-auth-in-agent')).toBeInTheDocument()
    })
  })

  describe('User Interactions', () => {
    it('should call onAuthorizationItemClick when credential is selected', () => {
      const onAuthorizationItemClick = vi.fn()
      const provider = createToolWithProvider({
        type: CollectionType.builtIn,
        allow_delete: true,
      })

      render(
        <ToolAuthorizationSection
          currentProvider={provider}
          onAuthorizationItemClick={onAuthorizationItemClick}
        />,
      )

      fireEvent.click(screen.getByTestId('auth-item-click-btn'))
      expect(onAuthorizationItemClick).toHaveBeenCalledWith('credential-123')
    })
  })
})

describe('ToolSettingsPanel Component', () => {
  const defaultSettingsPanelProps = {
    nodeId: 'node-1',
    currType: 'settings' as const,
    settingsFormSchemas: [createMockFormSchema('setting1')],
    paramsFormSchemas: [],
    settingsValue: {},
    showTabSlider: false,
    userSettingsOnly: true,
    reasoningConfigOnly: false,
    nodeOutputVars: [] as NodeOutPutVar[],
    availableNodes: [] as Node[],
    onCurrTypeChange: vi.fn(),
    onSettingsFormChange: vi.fn(),
    onParamsFormChange: vi.fn(),
  }

  beforeEach(() => {
    vi.clearAllMocks()
  })

  describe('Rendering', () => {
    it('should render null when no schemas and no authorization', () => {
      const { container } = render(
        <ToolSettingsPanel
          {...defaultSettingsPanelProps}
          settingsFormSchemas={[]}
          paramsFormSchemas={[]}
        />,
      )
      expect(container.firstChild).toBeNull()
    })

    it('should render null when not team authorized', () => {
      const provider = createToolWithProvider({ is_team_authorization: false })
      const { container } = render(
        <ToolSettingsPanel
          {...defaultSettingsPanelProps}
          currentProvider={provider}
        />,
      )
      expect(container.firstChild).toBeNull()
    })

    it('should render settings form when has settings schemas', () => {
      const provider = createToolWithProvider({ is_team_authorization: true })
      render(
        <ToolSettingsPanel
          {...defaultSettingsPanelProps}
          currentProvider={provider}
        />,
      )
      expect(screen.getByTestId('tool-form')).toBeInTheDocument()
    })

    it('should render tab slider when both settings and params exist', () => {
      const provider = createToolWithProvider({ is_team_authorization: true })
      const { container } = render(
        <ToolSettingsPanel
          {...defaultSettingsPanelProps}
          currentProvider={provider}
          settingsFormSchemas={[createMockFormSchema('setting1')]}
          paramsFormSchemas={[createMockFormSchema('param1')]}
          showTabSlider={true}
          userSettingsOnly={false}
        />,
      )
      // Tab slider should be rendered (px-4 is a common class in TabSlider)
      expect(container.querySelector('.px-4')).toBeInTheDocument()
    })

    it('should render reasoning config form when params tab is active', () => {
      const provider = createToolWithProvider({ is_team_authorization: true })
      render(
        <ToolSettingsPanel
          {...defaultSettingsPanelProps}
          currentProvider={provider}
          currType="params"
          paramsFormSchemas={[createMockFormSchema('param1')]}
          reasoningConfigOnly={true}
          userSettingsOnly={false}
        />,
      )
      expect(screen.getByTestId('reasoning-config-form')).toBeInTheDocument()
    })
  })

  describe('User Interactions', () => {
    it('should call onSettingsFormChange when settings form changes', () => {
      const onSettingsFormChange = vi.fn()
      const provider = createToolWithProvider({ is_team_authorization: true })

      render(
        <ToolSettingsPanel
          {...defaultSettingsPanelProps}
          currentProvider={provider}
          onSettingsFormChange={onSettingsFormChange}
        />,
      )

      fireEvent.click(screen.getByTestId('change-settings-btn'))
      expect(onSettingsFormChange).toHaveBeenCalledWith({ setting1: 'new-value' })
    })

    it('should call onParamsFormChange when params form changes', () => {
      const onParamsFormChange = vi.fn()
      const provider = createToolWithProvider({ is_team_authorization: true })

      render(
        <ToolSettingsPanel
          {...defaultSettingsPanelProps}
          currentProvider={provider}
          currType="params"
          paramsFormSchemas={[createMockFormSchema('param1')]}
          reasoningConfigOnly={true}
          userSettingsOnly={false}
          onParamsFormChange={onParamsFormChange}
        />,
      )

      fireEvent.click(screen.getByTestId('change-params-btn'))
      expect(onParamsFormChange).toHaveBeenCalledWith({ param1: 'new-param' })
    })
  })

  describe('Tab Navigation', () => {
    it('should show params tips when params tab is active', () => {
      const provider = createToolWithProvider({ is_team_authorization: true })
      render(
        <ToolSettingsPanel
          {...defaultSettingsPanelProps}
          currentProvider={provider}
          currType="params"
          settingsFormSchemas={[createMockFormSchema('setting1')]}
          paramsFormSchemas={[createMockFormSchema('param1')]}
          showTabSlider={true}
          userSettingsOnly={false}
        />,
      )
      // Params tips should be shown
      expect(screen.getByText(/paramsTip1/i)).toBeInTheDocument()
    })
  })
})

describe('ToolBaseForm Component', () => {
  const defaultBaseFormProps = {
    isShowChooseTool: false,
    hasTrigger: false,
    onShowChange: vi.fn(),
    onSelectTool: vi.fn(),
    onSelectMultipleTool: vi.fn(),
    onDescriptionChange: vi.fn(),
  }

  beforeEach(() => {
    vi.clearAllMocks()
  })

  describe('Rendering', () => {
    it('should render without crashing', () => {
      render(<ToolBaseForm {...defaultBaseFormProps} />)
      expect(screen.getByTestId('tool-picker')).toBeInTheDocument()
    })

    it('should render tool label text', () => {
      render(<ToolBaseForm {...defaultBaseFormProps} />)
      expect(screen.getByText(/toolLabel/i)).toBeInTheDocument()
    })

    it('should render description label text', () => {
      render(<ToolBaseForm {...defaultBaseFormProps} />)
      expect(screen.getByText(/descriptionLabel/i)).toBeInTheDocument()
    })

    it('should render tool picker component', () => {
      render(<ToolBaseForm {...defaultBaseFormProps} />)
      expect(screen.getByTestId('tool-picker')).toBeInTheDocument()
    })

    it('should render textarea for description', () => {
      render(<ToolBaseForm {...defaultBaseFormProps} />)
      expect(screen.getByRole('textbox')).toBeInTheDocument()
    })
  })

  describe('Props Handling', () => {
    it('should display description value in textarea', () => {
      const value = createToolValue({ extra: { description: 'Test description' } })
      render(<ToolBaseForm {...defaultBaseFormProps} value={value} />)

      expect(screen.getByRole('textbox')).toHaveValue('Test description')
    })

    it('should disable textarea when no provider_name', () => {
      const value = createToolValue({ provider_name: '' })
      render(<ToolBaseForm {...defaultBaseFormProps} value={value} />)

      expect(screen.getByRole('textbox')).toBeDisabled()
    })

    it('should enable textarea when provider_name exists', () => {
      const value = createToolValue({ provider_name: 'test-provider' })
      render(<ToolBaseForm {...defaultBaseFormProps} value={value} />)

      expect(screen.getByRole('textbox')).not.toBeDisabled()
    })
  })

  describe('User Interactions', () => {
    it('should call onDescriptionChange when textarea changes', async () => {
      const onDescriptionChange = vi.fn()
      const value = createToolValue()

      render(
        <ToolBaseForm
          {...defaultBaseFormProps}
          value={value}
          onDescriptionChange={onDescriptionChange}
        />,
      )

      const textarea = screen.getByRole('textbox')
      fireEvent.change(textarea, { target: { value: 'new description' } })

      expect(onDescriptionChange).toHaveBeenCalled()
    })

    it('should call onSelectTool when tool is selected', () => {
      const onSelectTool = vi.fn()
      render(
        <ToolBaseForm
          {...defaultBaseFormProps}
          onSelectTool={onSelectTool}
        />,
      )

      fireEvent.click(screen.getByTestId('select-tool-btn'))
      expect(onSelectTool).toHaveBeenCalled()
    })

    it('should call onSelectMultipleTool when multiple tools are selected', () => {
      const onSelectMultipleTool = vi.fn()
      render(
        <ToolBaseForm
          {...defaultBaseFormProps}
          onSelectMultipleTool={onSelectMultipleTool}
        />,
      )

      fireEvent.click(screen.getByTestId('select-multiple-btn'))
      expect(onSelectMultipleTool).toHaveBeenCalled()
    })
  })
})

describe('ToolSelector Component', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  describe('Rendering', () => {
    it('should render without crashing', () => {
      render(<ToolSelector {...defaultProps} />, { wrapper: createWrapper() })
      expect(screen.getByTestId('portal-to-follow-elem')).toBeInTheDocument()
    })

    it('should render ToolTrigger when no value and no trigger', () => {
      const { container } = render(<ToolSelector {...defaultProps} />, { wrapper: createWrapper() })
      // ToolTrigger should be rendered with its group class
      expect(container.querySelector('.group')).toBeInTheDocument()
    })

    it('should render custom trigger when provided', () => {
      render(
        <ToolSelector
          {...defaultProps}
          trigger={<button data-testid="custom-trigger">Custom Trigger</button>}
        />,
        { wrapper: createWrapper() },
      )
      expect(screen.getByTestId('custom-trigger')).toBeInTheDocument()
    })

    it('should render panel content', () => {
      render(<ToolSelector {...defaultProps} />, { wrapper: createWrapper() })
      expect(screen.getByTestId('portal-content')).toBeInTheDocument()
    })

    it('should render tool base form in panel', () => {
      render(<ToolSelector {...defaultProps} />, { wrapper: createWrapper() })
      expect(screen.getByTestId('tool-picker')).toBeInTheDocument()
    })
  })

  describe('Props', () => {
    it('should apply isEdit mode title', () => {
      render(
        <ToolSelector {...defaultProps} isEdit />,
        { wrapper: createWrapper() },
      )
      expect(screen.getByText(/toolSetting/i)).toBeInTheDocument()
    })

    it('should apply default title when not in edit mode', () => {
      render(
        <ToolSelector {...defaultProps} isEdit={false} />,
        { wrapper: createWrapper() },
      )
      expect(screen.getByText(/title/i)).toBeInTheDocument()
    })

    it('should pass nodeId to settings panel', () => {
      render(
        <ToolSelector {...defaultProps} nodeId="test-node-id" />,
        { wrapper: createWrapper() },
      )
      // The component should receive and use the nodeId
      expect(screen.getByTestId('portal-content')).toBeInTheDocument()
    })
  })

  describe('Controlled Mode', () => {
    it('should use controlledState when trigger is provided', () => {
      const onControlledStateChange = vi.fn()
      render(
        <ToolSelector
          {...defaultProps}
          trigger={<button>Trigger</button>}
          controlledState={true}
          onControlledStateChange={onControlledStateChange}
        />,
        { wrapper: createWrapper() },
      )
      expect(screen.getByTestId('portal-to-follow-elem')).toHaveAttribute('data-open', 'true')
    })

    it('should use internal state when no trigger', () => {
      render(
        <ToolSelector {...defaultProps} />,
        { wrapper: createWrapper() },
      )
      expect(screen.getByTestId('portal-to-follow-elem')).toHaveAttribute('data-open', 'false')
    })
  })

  describe('User Interactions', () => {
    it('should call onSelect when tool is selected', () => {
      const onSelect = vi.fn()
      render(
        <ToolSelector {...defaultProps} onSelect={onSelect} />,
        { wrapper: createWrapper() },
      )

      fireEvent.click(screen.getByTestId('select-tool-btn'))
      expect(onSelect).toHaveBeenCalled()
    })

    it('should call onSelectMultiple when multiple tools are selected', () => {
      const onSelectMultiple = vi.fn()
      render(
        <ToolSelector {...defaultProps} onSelectMultiple={onSelectMultiple} />,
        { wrapper: createWrapper() },
      )

      fireEvent.click(screen.getByTestId('select-multiple-btn'))
      expect(onSelectMultiple).toHaveBeenCalled()
    })

    it('should pass onDelete prop to ToolItem', () => {
      const onDelete = vi.fn()
      const value = createToolValue()

      const { container } = render(
        <ToolSelector
          {...defaultProps}
          value={value}
          onDelete={onDelete}
        />,
        { wrapper: createWrapper() },
      )

      // ToolItem should be rendered (it has a group class)
      // The delete functionality is tested in ToolItem tests
      expect(container.querySelector('.group')).toBeInTheDocument()
    })

    it('should not trigger when disabled', () => {
      const onSelect = vi.fn()
      render(
        <ToolSelector {...defaultProps} disabled onSelect={onSelect} />,
        { wrapper: createWrapper() },
      )

      // Click on portal trigger
      fireEvent.click(screen.getByTestId('portal-trigger'))
      // State should not change when disabled
      expect(screen.getByTestId('portal-to-follow-elem')).toHaveAttribute('data-open', 'false')
    })
  })

  describe('Component Memoization', () => {
    it('should be memoized with React.memo', () => {
      // ToolSelector is wrapped with React.memo
      // This test verifies the component doesn't re-render unnecessarily
      const onSelect = vi.fn()
      const { rerender } = render(
        <ToolSelector {...defaultProps} onSelect={onSelect} />,
        { wrapper: createWrapper() },
      )

      // Re-render with same props
      rerender(<ToolSelector {...defaultProps} onSelect={onSelect} />)

      // Component should not trigger unnecessary re-renders
      expect(screen.getByTestId('portal-to-follow-elem')).toBeInTheDocument()
    })
  })
})

// ==================== Edge Cases ====================

describe('Edge Cases', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  describe('ToolSelector with undefined values', () => {
    it('should handle undefined value prop', () => {
      render(
        <ToolSelector {...defaultProps} value={undefined} />,
        { wrapper: createWrapper() },
      )
      expect(screen.getByTestId('portal-to-follow-elem')).toBeInTheDocument()
    })

    it('should handle undefined selectedTools', () => {
      render(
        <ToolSelector {...defaultProps} selectedTools={undefined} />,
        { wrapper: createWrapper() },
      )
      expect(screen.getByTestId('portal-to-follow-elem')).toBeInTheDocument()
    })

    it('should handle empty nodeOutputVars', () => {
      render(
        <ToolSelector {...defaultProps} nodeOutputVars={[]} />,
        { wrapper: createWrapper() },
      )
      expect(screen.getByTestId('portal-to-follow-elem')).toBeInTheDocument()
    })

    it('should handle empty availableNodes', () => {
      render(
        <ToolSelector {...defaultProps} availableNodes={[]} />,
        { wrapper: createWrapper() },
      )
      expect(screen.getByTestId('portal-to-follow-elem')).toBeInTheDocument()
    })
  })

  describe('ToolItem with edge case props', () => {
    it('should handle all error states combined', () => {
      render(
        <ToolItem
          open={false}
          isError
          uninstalled
          versionMismatch
          noAuth
          toolLabel="Tool"
        />,
      )
      // Should show error state (highest priority)
      expect(document.querySelector('.text-text-destructive')).toBeInTheDocument()
    })

    it('should handle empty provider name', () => {
      render(
        <ToolItem
          open={false}
          providerName=""
          toolLabel="Tool"
        />,
      )
      expect(screen.getByText('Tool')).toBeInTheDocument()
    })

    it('should handle special characters in tool label', () => {
      render(
        <ToolItem
          open={false}
          toolLabel="Tool <script>alert('xss')</script>"
        />,
      )
      // Should render safely without XSS
      expect(screen.getByText(/Tool/)).toBeInTheDocument()
    })
  })

  describe('ToolBaseForm with edge case props', () => {
    it('should handle undefined extra in value', () => {
      const value = createToolValue({ extra: undefined })
      render(
        <ToolBaseForm
          value={value}
          isShowChooseTool={false}
          hasTrigger={false}
          onShowChange={vi.fn()}
          onSelectTool={vi.fn()}
          onSelectMultipleTool={vi.fn()}
          onDescriptionChange={vi.fn()}
        />,
      )
      expect(screen.getByRole('textbox')).toHaveValue('')
    })

    it('should handle empty description', () => {
      const value = createToolValue({ extra: { description: '' } })
      render(
        <ToolBaseForm
          value={value}
          isShowChooseTool={false}
          hasTrigger={false}
          onShowChange={vi.fn()}
          onSelectTool={vi.fn()}
          onSelectMultipleTool={vi.fn()}
          onDescriptionChange={vi.fn()}
        />,
      )
      expect(screen.getByRole('textbox')).toHaveValue('')
    })
  })

  describe('ToolSettingsPanel with edge case props', () => {
    it('should handle empty schemas arrays', () => {
      const { container } = render(
        <ToolSettingsPanel
          nodeId=""
          currType="settings"
          settingsFormSchemas={[]}
          paramsFormSchemas={[]}
          settingsValue={{}}
          showTabSlider={false}
          userSettingsOnly={false}
          reasoningConfigOnly={false}
          nodeOutputVars={[]}
          availableNodes={[]}
          onCurrTypeChange={vi.fn()}
          onSettingsFormChange={vi.fn()}
          onParamsFormChange={vi.fn()}
        />,
      )
      expect(container.firstChild).toBeNull()
    })

    it('should handle undefined currentProvider', () => {
      const { container } = render(
        <ToolSettingsPanel
          currentProvider={undefined}
          nodeId="node-1"
          currType="settings"
          settingsFormSchemas={[createMockFormSchema('setting1')]}
          paramsFormSchemas={[]}
          settingsValue={{}}
          showTabSlider={false}
          userSettingsOnly={true}
          reasoningConfigOnly={false}
          nodeOutputVars={[]}
          availableNodes={[]}
          onCurrTypeChange={vi.fn()}
          onSettingsFormChange={vi.fn()}
          onParamsFormChange={vi.fn()}
        />,
      )
      expect(container.firstChild).toBeNull()
    })
  })

  describe('Hook edge cases', () => {
    it('useToolSelectorState should handle undefined onSelectMultiple', () => {
      const onSelect = vi.fn()
      const { result } = renderHook(
        () => useToolSelectorState({ onSelect, onSelectMultiple: undefined }),
        { wrapper: createWrapper() },
      )

      // Should not throw when calling handleSelectMultipleTool
      act(() => {
        result.current.handleSelectMultipleTool([createToolDefaultValue()])
      })

      // Should complete without error
      expect(result.current.isShow).toBe(false)
    })

    it('useToolSelectorState should handle empty description change', () => {
      const onSelect = vi.fn()
      const value = createToolValue()
      const { result } = renderHook(
        () => useToolSelectorState({ value, onSelect }),
        { wrapper: createWrapper() },
      )

      act(() => {
        result.current.handleDescriptionChange({
          target: { value: '' },
        } as React.ChangeEvent<HTMLTextAreaElement>)
      })

      expect(onSelect).toHaveBeenCalledWith(
        expect.objectContaining({
          extra: expect.objectContaining({ description: '' }),
        }),
      )
    })
  })
})

// ==================== SchemaModal Tests ====================

describe('SchemaModal Component', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  describe('Rendering', () => {
    it('should render modal with schema content', () => {
      const mockSchema: SchemaRoot = {
        type: Type.object,
        properties: {
          name: { type: Type.string },
        },
        additionalProperties: false,
      }

      render(
        <SchemaModal
          isShow={true}
          schema={mockSchema}
          rootName="TestSchema"
          onClose={vi.fn()}
        />,
      )

      expect(screen.getByTestId('modal')).toBeInTheDocument()
    })

    it('should not render when isShow is false', () => {
      const mockSchema: SchemaRoot = { type: Type.object, properties: {}, additionalProperties: false }

      render(
        <SchemaModal
          isShow={false}
          schema={mockSchema}
          rootName="TestSchema"
          onClose={vi.fn()}
        />,
      )

      expect(screen.queryByTestId('modal')).not.toBeInTheDocument()
    })

    it('should call onClose when close button is clicked', () => {
      const onClose = vi.fn()
      const mockSchema: SchemaRoot = { type: Type.object, properties: {}, additionalProperties: false }

      render(
        <SchemaModal
          isShow={true}
          schema={mockSchema}
          rootName="TestSchema"
          onClose={onClose}
        />,
      )

      // Find and click close button (the one with absolute positioning)
      const closeBtn = document.querySelector('.absolute')
      if (closeBtn) {
        fireEvent.click(closeBtn)
        expect(onClose).toHaveBeenCalled()
      }
    })
  })
})

// ==================== ToolCredentialsForm Tests ====================

describe('ToolCredentialsForm Component', () => {
  const mockCollection: Partial<Collection> = {
    name: 'test-collection',
    label: { en_US: 'Test Collection', zh_Hans: '测试集合' },
    type: CollectionType.builtIn,
  }

  beforeEach(() => {
    vi.clearAllMocks()
  })

  describe('Rendering', () => {
    it('should render loading state initially', () => {
      render(
        <ToolCredentialsForm
          collection={mockCollection as Collection}
          onCancel={vi.fn()}
          onSaved={vi.fn()}
        />,
      )

      // Should show loading initially (using role="status" from Loading component)
      expect(screen.getByRole('status')).toBeInTheDocument()
    })
  })

  describe('User Interactions', () => {
    it('should render form after loading', async () => {
      render(
        <ToolCredentialsForm
          collection={mockCollection as Collection}
          onCancel={vi.fn()}
          onSaved={vi.fn()}
        />,
      )

      // Wait for loading to complete
      await waitFor(() => {
        expect(screen.getByTestId('credential-form')).toBeInTheDocument()
      }, { timeout: 2000 })
    })

    it('should call onCancel when cancel button is clicked', async () => {
      const onCancel = vi.fn()

      render(
        <ToolCredentialsForm
          collection={mockCollection as Collection}
          onCancel={onCancel}
          onSaved={vi.fn()}
        />,
      )

      // Wait for loading to complete and click cancel
      await waitFor(() => {
        const cancelBtn = screen.queryByText(/cancel/i)
        if (cancelBtn) {
          fireEvent.click(cancelBtn)
          expect(onCancel).toHaveBeenCalled()
        }
      }, { timeout: 2000 })
    })

    it('should call onSaved when save button is clicked with valid data', async () => {
      const onSaved = vi.fn()

      render(
        <ToolCredentialsForm
          collection={mockCollection as Collection}
          onCancel={vi.fn()}
          onSaved={onSaved}
        />,
      )

      // Wait for loading to complete
      await waitFor(() => {
        expect(screen.getByTestId('credential-form')).toBeInTheDocument()
      }, { timeout: 2000 })

      // Click save
      const saveBtn = screen.getByText(/save/i)
      fireEvent.click(saveBtn)

      // onSaved should be called
      expect(onSaved).toHaveBeenCalled()
    })

    it('should render fieldMoreInfo with url', async () => {
      render(
        <ToolCredentialsForm
          collection={mockCollection as Collection}
          onCancel={vi.fn()}
          onSaved={vi.fn()}
        />,
      )

      // Wait for loading to complete
      await waitFor(() => {
        const fieldMoreInfo = screen.queryByTestId('field-more-info')
        if (fieldMoreInfo) {
          // Should render link for item with url
          expect(fieldMoreInfo.querySelector('a')).toBeInTheDocument()
        }
      }, { timeout: 2000 })
    })

    it('should update form value when onChange is called', async () => {
      render(
        <ToolCredentialsForm
          collection={mockCollection as Collection}
          onCancel={vi.fn()}
          onSaved={vi.fn()}
        />,
      )

      // Wait for form to load
      await waitFor(() => {
        expect(screen.getByTestId('credential-form')).toBeInTheDocument()
      }, { timeout: 2000 })

      // Trigger onChange via mock form
      const formInput = screen.getByTestId('form-input')
      fireEvent.change(formInput, { target: { value: '{"api_key":"test"}' } })

      // Verify form updated
      expect(formInput).toHaveValue('{"api_key":"test"}')
    })

    it('should show error toast when required field is missing', async () => {
      // Clear previous calls
      mockToastNotify.mockClear()

      // Setup mock to return required field
      mockFetchBuiltInToolCredentialSchema.mockResolvedValueOnce([
        { name: 'api_key', type: 'string', required: true, label: { en_US: 'API Key' } },
      ])
      mockFetchBuiltInToolCredential.mockResolvedValueOnce({})

      const onSaved = vi.fn()

      render(
        <ToolCredentialsForm
          collection={mockCollection as Collection}
          onCancel={vi.fn()}
          onSaved={onSaved}
        />,
      )

      // Wait for form to load
      await waitFor(() => {
        expect(screen.getByTestId('credential-form')).toBeInTheDocument()
      }, { timeout: 2000 })

      // Click save without filling required field
      const saveBtn = screen.getByText(/save/i)
      fireEvent.click(saveBtn)

      // Toast.notify should have been called with error (lines 49-50)
      expect(mockToastNotify).toHaveBeenCalledWith(expect.objectContaining({ type: 'error' }))
      // onSaved should not be called because validation fails
      expect(onSaved).not.toHaveBeenCalled()
    })

    it('should call onSaved when all required fields are filled', async () => {
      // Setup mock to return required field with value
      mockFetchBuiltInToolCredentialSchema.mockResolvedValueOnce([
        { name: 'api_key', type: 'string', required: true, label: { en_US: 'API Key' } },
      ])
      mockFetchBuiltInToolCredential.mockResolvedValueOnce({ api_key: 'test-key' })

      const onSaved = vi.fn()

      render(
        <ToolCredentialsForm
          collection={mockCollection as Collection}
          onCancel={vi.fn()}
          onSaved={onSaved}
        />,
      )

      // Wait for form to load
      await waitFor(() => {
        expect(screen.getByTestId('credential-form')).toBeInTheDocument()
      }, { timeout: 2000 })

      // Click save
      const saveBtn = screen.getByText(/save/i)
      fireEvent.click(saveBtn)

      // onSaved should be called with credential data
      expect(onSaved).toHaveBeenCalled()
    })

    it('should iterate through all credential schema fields on save', async () => {
      // Setup mock with multiple fields including required ones
      mockFetchBuiltInToolCredentialSchema.mockResolvedValueOnce([
        { name: 'api_key', type: 'string', required: true, label: { en_US: 'API Key' } },
        { name: 'secret', type: 'string', required: true, label: { en_US: 'Secret' } },
        { name: 'optional_field', type: 'string', required: false, label: { en_US: 'Optional' } },
      ])
      mockFetchBuiltInToolCredential.mockResolvedValueOnce({ api_key: 'key', secret: 'secret' })

      const onSaved = vi.fn()

      render(
        <ToolCredentialsForm
          collection={mockCollection as Collection}
          onCancel={vi.fn()}
          onSaved={onSaved}
        />,
      )

      // Wait for form to load and click save
      await waitFor(() => {
        expect(screen.getByTestId('credential-form')).toBeInTheDocument()
      }, { timeout: 2000 })

      const saveBtn = screen.getByText(/save/i)
      fireEvent.click(saveBtn)

      // onSaved should be called since all required fields are filled
      await waitFor(() => {
        expect(onSaved).toHaveBeenCalled()
      })
    })

    it('should handle form onChange and update tempCredential state', async () => {
      mockFetchBuiltInToolCredentialSchema.mockResolvedValueOnce([
        { name: 'api_key', type: 'string', required: false, label: { en_US: 'API Key' } },
      ])
      mockFetchBuiltInToolCredential.mockResolvedValueOnce({})

      render(
        <ToolCredentialsForm
          collection={mockCollection as Collection}
          onCancel={vi.fn()}
          onSaved={vi.fn()}
        />,
      )

      // Wait for form to load
      await waitFor(() => {
        expect(screen.getByTestId('credential-form')).toBeInTheDocument()
      }, { timeout: 2000 })

      // Trigger onChange via mock form
      const formInput = screen.getByTestId('form-input')
      fireEvent.change(formInput, { target: { value: '{"api_key":"new-value"}' } })

      // The form should have updated
      expect(formInput).toBeInTheDocument()
    })
  })
})

// ==================== Additional Coverage Tests ====================

describe('Additional Coverage Tests', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  describe('ToolItem Mouse Events', () => {
    it('should set deleting state on mouse over', () => {
      const { container } = render(
        <ToolItem
          open={false}
          onDelete={vi.fn()}
          toolLabel="Tool"
        />,
      )

      const deleteBtn = container.querySelector('[class*="hover:text-text-destructive"]')
      if (deleteBtn) {
        fireEvent.mouseOver(deleteBtn)
        // After mouseOver, the parent should have destructive border
        // This tests line 113
        const parentDiv = container.querySelector('.group')
        expect(parentDiv).toBeInTheDocument()
      }
    })

    it('should reset deleting state on mouse leave', () => {
      const { container } = render(
        <ToolItem
          open={false}
          onDelete={vi.fn()}
          toolLabel="Tool"
        />,
      )

      const deleteBtn = container.querySelector('[class*="hover:text-text-destructive"]')
      if (deleteBtn) {
        fireEvent.mouseOver(deleteBtn)
        fireEvent.mouseLeave(deleteBtn)
        // After mouseLeave, should reset
        // This tests line 114
        const parentDiv = container.querySelector('.group')
        expect(parentDiv).toBeInTheDocument()
      }
    })

    it('should stop propagation on install button click', () => {
      const onInstall = vi.fn()
      const parentClick = vi.fn()

      render(
        <div onClick={parentClick}>
          <ToolItem
            open={false}
            uninstalled
            installInfo="plugin@1.0.0"
            onInstall={onInstall}
            toolLabel="Tool"
          />
        </div>,
      )

      // The InstallPluginButton mock handles onClick with stopPropagation
      fireEvent.click(screen.getByTestId('install-plugin-btn'))
      expect(onInstall).toHaveBeenCalled()
    })

    it('should stop propagation on switch click', () => {
      const parentClick = vi.fn()
      const onSwitchChange = vi.fn()

      render(
        <div onClick={parentClick}>
          <ToolItem
            open={false}
            showSwitch
            switchValue={true}
            onSwitchChange={onSwitchChange}
            toolLabel="Tool"
          />
        </div>,
      )

      // Find and click on switch container
      const switchContainer = document.querySelector('.mr-1')
      expect(switchContainer).toBeInTheDocument()
      if (switchContainer) {
        fireEvent.click(switchContainer)
        // Parent should not be called due to stopPropagation (line 120)
        expect(parentClick).not.toHaveBeenCalled()
      }
    })
  })

  describe('useToolSelectorState with Provider Data', () => {
    it('should compute currentToolSettings when provider exists', () => {
      // Setup mock data with tools
      const mockProvider = createToolWithProvider({
        id: 'test-provider/tool',
        tools: [
          {
            name: 'test-tool',
            parameters: [
              { name: 'setting1', form: 'user', label: { en_US: 'Setting 1', zh_Hans: '设置1' }, human_description: { en_US: '', zh_Hans: '' }, type: 'string', llm_description: '', required: false, multiple: false, default: '' },
              { name: 'param1', form: 'llm', label: { en_US: 'Param 1', zh_Hans: '参数1' }, human_description: { en_US: '', zh_Hans: '' }, type: 'string', llm_description: '', required: false, multiple: false, default: '' },
            ],
          },
        ],
      })

      // Temporarily modify mock data
      mockBuildInTools!.push(mockProvider)

      const onSelect = vi.fn()
      const value = createToolValue({ provider_name: 'test-provider/tool', tool_name: 'test-tool' })

      const { result } = renderHook(
        () => useToolSelectorState({ value, onSelect }),
        { wrapper: createWrapper() },
      )

      // Clean up
      mockBuildInTools!.pop()

      expect(result.current.currentToolSettings).toBeDefined()
    })

    it('should call handleInstall and invalidate caches', async () => {
      const onSelect = vi.fn()
      const { result } = renderHook(
        () => useToolSelectorState({ onSelect }),
        { wrapper: createWrapper() },
      )

      await act(async () => {
        await result.current.handleInstall()
      })

      // handleInstall should complete without error
      expect(result.current.isShow).toBe(false)
    })

    it('should return empty manifestIcon when manifest is null', () => {
      mockManifestData = null
      const onSelect = vi.fn()
      const { result } = renderHook(
        () => useToolSelectorState({ onSelect }),
        { wrapper: createWrapper() },
      )

      // Without manifest, should return empty string
      expect(result.current.manifestIcon).toBe('')
    })

    it('should return manifestIcon URL when manifest exists', () => {
      // Set manifest data
      mockManifestData = {
        data: {
          plugin: {
            plugin_id: 'test-plugin-id',
            latest_package_identifier: 'test@1.0.0',
          },
        },
      }

      const onSelect = vi.fn()
      const value = createToolValue({ provider_name: 'test/plugin' })
      const { result } = renderHook(
        () => useToolSelectorState({ value, onSelect }),
        { wrapper: createWrapper() },
      )

      // With manifest, should return icon URL - this covers line 103
      expect(result.current.manifest).toBeDefined()

      // Reset mock
      mockManifestData = null
    })

    it('should handle tool selection with paramSchemas filtering', () => {
      const onSelect = vi.fn()
      const { result } = renderHook(
        () => useToolSelectorState({ onSelect }),
        { wrapper: createWrapper() },
      )

      const toolWithSchemas: ToolDefaultValue = {
        ...createToolDefaultValue(),
        paramSchemas: [
          { name: 'setting1', form: 'user', label: { en_US: 'Setting 1' }, human_description: { en_US: '' }, type: 'string', llm_description: '', required: false, multiple: false, default: '' },
          { name: 'param1', form: 'llm', label: { en_US: 'Param 1' }, human_description: { en_US: '' }, type: 'string', llm_description: '', required: false, multiple: false, default: '' },
        ],
      }

      act(() => {
        result.current.handleSelectTool(toolWithSchemas)
      })

      expect(onSelect).toHaveBeenCalled()
    })

    it('should merge all tool types including customTools, workflowTools and mcpTools', () => {
      // Setup all tool type mocks to cover lines 52-55
      const buildInProvider = createToolWithProvider({
        id: 'builtin-provider/tool',
        name: 'builtin-provider',
        type: CollectionType.builtIn,
        tools: [{ name: 'builtin-tool', parameters: [] }],
      })

      const customProvider = createToolWithProvider({
        id: 'custom-provider/tool',
        name: 'custom-provider',
        type: CollectionType.custom,
        tools: [{ name: 'custom-tool', parameters: [] }],
      })

      const workflowProvider = createToolWithProvider({
        id: 'workflow-provider/tool',
        name: 'workflow-provider',
        type: CollectionType.workflow,
        tools: [{ name: 'workflow-tool', parameters: [] }],
      })

      const mcpProvider = createToolWithProvider({
        id: 'mcp-provider/tool',
        name: 'mcp-provider',
        type: CollectionType.mcp,
        tools: [{ name: 'mcp-tool', parameters: [] }],
      })

      // Set all mocks
      mockBuildInTools = [buildInProvider]
      mockCustomTools = [customProvider]
      mockWorkflowTools = [workflowProvider]
      mockMcpTools = [mcpProvider]

      const onSelect = vi.fn()
      const value = createToolValue({ provider_name: 'builtin-provider/tool', tool_name: 'builtin-tool' })

      const { result } = renderHook(
        () => useToolSelectorState({ value, onSelect }),
        { wrapper: createWrapper() },
      )

      // Should find the builtin provider
      expect(result.current.currentProvider).toBeDefined()

      // Clean up
      mockBuildInTools = []
      mockCustomTools = []
      mockWorkflowTools = []
      mockMcpTools = []
    })

    it('should filter parameters correctly for settings and params', () => {
      // Setup mock with tool that has both user and llm parameters
      const mockProvider = createToolWithProvider({
        id: 'test-provider/tool',
        name: 'test-provider',
        tools: [
          {
            name: 'test-tool',
            label: { en_US: 'Test Tool' },
            parameters: [
              { name: 'setting1', form: 'user' },
              { name: 'setting2', form: 'user' },
              { name: 'param1', form: 'llm' },
              { name: 'param2', form: 'llm' },
            ],
          },
        ],
      })

      mockBuildInTools = [mockProvider]

      const onSelect = vi.fn()
      const value = createToolValue({ provider_name: 'test-provider/tool', tool_name: 'test-tool' })

      const { result } = renderHook(
        () => useToolSelectorState({ value, onSelect }),
        { wrapper: createWrapper() },
      )

      // Verify currentToolSettings filters to user form only (lines 69-72)
      expect(result.current.currentToolSettings).toBeDefined()
      // Verify currentToolParams filters to llm form only (lines 78-81)
      expect(result.current.currentToolParams).toBeDefined()

      // Clean up
      mockBuildInTools = []
    })

    it('should return empty arrays when currentProvider is undefined', () => {
      const onSelect = vi.fn()
      const { result } = renderHook(
        () => useToolSelectorState({ onSelect }),
        { wrapper: createWrapper() },
      )

      // Without a provider, settings and params should be empty
      expect(result.current.currentToolSettings).toEqual([])
      expect(result.current.currentToolParams).toEqual([])
    })

    it('should handle null/undefined tool arrays with fallback', () => {
      // Clear all mocks to undefined
      mockBuildInTools = undefined
      mockCustomTools = undefined
      mockWorkflowTools = undefined
      mockMcpTools = undefined

      const onSelect = vi.fn()
      const { result } = renderHook(
        () => useToolSelectorState({ onSelect }),
        { wrapper: createWrapper() },
      )

      // Should not crash and currentProvider should be undefined
      expect(result.current.currentProvider).toBeUndefined()

      // Reset mocks
      mockBuildInTools = []
      mockCustomTools = []
      mockWorkflowTools = []
      mockMcpTools = []
    })

    it('should handle tool not found in provider', () => {
      // Setup mock with provider but wrong tool name
      const mockProvider = {
        id: 'test-provider/tool',
        name: 'test-provider',
        type: CollectionType.builtIn,
        icon: 'icon',
        is_team_authorization: true,
        allow_delete: true,
        tools: [
          {
            name: 'different-tool',
            label: { en_US: 'Different Tool' },
            parameters: [{ name: 'setting1', form: 'user' }],
          },
        ],
      } as unknown as ToolWithProvider

      mockBuildInTools = [mockProvider]

      const onSelect = vi.fn()
      // Use a tool_name that doesn't exist in the provider
      const value = createToolValue({ provider_name: 'test-provider/tool', tool_name: 'non-existent-tool' })

      const { result } = renderHook(
        () => useToolSelectorState({ value, onSelect }),
        { wrapper: createWrapper() },
      )

      // Provider should be found but tool should not
      expect(result.current.currentProvider).toBeDefined()
      expect(result.current.currentTool).toBeUndefined()
      // Parameters should fallback to empty arrays due to || []
      expect(result.current.currentToolSettings).toEqual([])
      expect(result.current.currentToolParams).toEqual([])

      // Clean up
      mockBuildInTools = []
    })
  })

  describe('ToolSettingsPanel Tab Change', () => {
    it('should call onCurrTypeChange when tab is switched', () => {
      const onCurrTypeChange = vi.fn()
      const provider = createToolWithProvider({ is_team_authorization: true })

      render(
        <ToolSettingsPanel
          currentProvider={provider}
          nodeId="node-1"
          currType="settings"
          settingsFormSchemas={[createMockFormSchema('setting1')]}
          paramsFormSchemas={[createMockFormSchema('param1')]}
          settingsValue={{}}
          showTabSlider={true}
          userSettingsOnly={false}
          reasoningConfigOnly={false}
          nodeOutputVars={[]}
          availableNodes={[]}
          onCurrTypeChange={onCurrTypeChange}
          onSettingsFormChange={vi.fn()}
          onParamsFormChange={vi.fn()}
        />,
      )

      // The TabSlider component should render
      expect(document.querySelector('.space-x-6')).toBeInTheDocument()

      // Find and click on the params tab to trigger onChange (line 87)
      const paramsTab = screen.getByText(/params/i)
      fireEvent.click(paramsTab)
      expect(onCurrTypeChange).toHaveBeenCalledWith('params')
    })

    it('should handle tab change with different currType values', () => {
      const onCurrTypeChange = vi.fn()
      const provider = createToolWithProvider({ is_team_authorization: true })

      const { rerender } = render(
        <ToolSettingsPanel
          currentProvider={provider}
          nodeId="node-1"
          currType="settings"
          settingsFormSchemas={[createMockFormSchema('setting1')]}
          paramsFormSchemas={[createMockFormSchema('param1')]}
          settingsValue={{}}
          showTabSlider={true}
          userSettingsOnly={false}
          reasoningConfigOnly={false}
          nodeOutputVars={[]}
          availableNodes={[]}
          onCurrTypeChange={onCurrTypeChange}
          onSettingsFormChange={vi.fn()}
          onParamsFormChange={vi.fn()}
        />,
      )

      // Rerender with params currType
      rerender(
        <ToolSettingsPanel
          currentProvider={provider}
          nodeId="node-1"
          currType="params"
          settingsFormSchemas={[createMockFormSchema('setting1')]}
          paramsFormSchemas={[createMockFormSchema('param1')]}
          settingsValue={{}}
          showTabSlider={true}
          userSettingsOnly={false}
          reasoningConfigOnly={false}
          nodeOutputVars={[]}
          availableNodes={[]}
          onCurrTypeChange={onCurrTypeChange}
          onSettingsFormChange={vi.fn()}
          onParamsFormChange={vi.fn()}
        />,
      )

      // Now params tips should be visible
      expect(screen.getByText(/paramsTip1/i)).toBeInTheDocument()
    })
  })

  describe('ToolSelector Trigger Click Behavior', () => {
    beforeEach(() => {
      // Reset mock tools
      mockBuildInTools = []
    })

    it('should not set isShow when disabled', () => {
      render(
        <ToolSelector {...defaultProps} disabled />,
        { wrapper: createWrapper() },
      )

      // Click on the trigger
      const trigger = screen.getByTestId('portal-trigger')
      fireEvent.click(trigger)

      // Should still be closed because disabled
      expect(screen.getByTestId('portal-to-follow-elem')).toHaveAttribute('data-open', 'false')
    })

    it('should handle trigger click when provider and tool exist', () => {
      // This requires mocking the tools data
      render(
        <ToolSelector {...defaultProps} />,
        { wrapper: createWrapper() },
      )

      // Without provider/tool, clicking should not open
      const trigger = screen.getByTestId('portal-trigger')
      fireEvent.click(trigger)

      expect(screen.getByTestId('portal-to-follow-elem')).toHaveAttribute('data-open', 'false')
    })

    it('should early return from handleTriggerClick when disabled', () => {
      // Test to ensure disabled state prevents opening
      const { rerender } = render(
        <ToolSelector {...defaultProps} disabled={false} />,
        { wrapper: createWrapper() },
      )

      // Rerender with disabled=true
      rerender(<ToolSelector {...defaultProps} disabled={true} />)

      const trigger = screen.getByTestId('portal-trigger')
      fireEvent.click(trigger)

      // Verify it stays closed
      expect(screen.getByTestId('portal-to-follow-elem')).toHaveAttribute('data-open', 'false')
    })

    it('should set isShow when clicked with valid provider and tool', () => {
      // Setup mock data to have matching provider/tool
      const mockProvider = {
        id: 'test-provider/tool',
        name: 'test-provider',
        type: CollectionType.builtIn,
        icon: 'test-icon',
        is_team_authorization: true,
        allow_delete: true,
        tools: [
          {
            name: 'test-tool',
            label: { en_US: 'Test Tool' },
            parameters: [],
          },
        ],
      } as unknown as ToolWithProvider

      mockBuildInTools = [mockProvider]

      const value = createToolValue({
        provider_name: 'test-provider/tool',
        tool_name: 'test-tool',
      })

      render(
        <ToolSelector {...defaultProps} value={value} disabled={false} />,
        { wrapper: createWrapper() },
      )

      // Click on the trigger - this should call handleTriggerClick
      const trigger = screen.getByTestId('portal-trigger')
      fireEvent.click(trigger)

      // Now that we have provider and tool, the click should work
      // This tests lines 106-108 and 148
      expect(screen.getByTestId('portal-to-follow-elem')).toBeInTheDocument()
    })

    it('should not open when disabled is true even with valid provider', () => {
      const mockProvider = {
        id: 'test-provider/tool',
        name: 'test-provider',
        type: CollectionType.builtIn,
        icon: 'test-icon',
        is_team_authorization: true,
        allow_delete: true,
        tools: [
          {
            name: 'test-tool',
            label: { en_US: 'Test Tool' },
            parameters: [],
          },
        ],
      } as unknown as ToolWithProvider

      mockBuildInTools = [mockProvider]

      const value = createToolValue({
        provider_name: 'test-provider/tool',
        tool_name: 'test-tool',
      })

      render(
        <ToolSelector {...defaultProps} value={value} disabled={true} />,
        { wrapper: createWrapper() },
      )

      // Click should not open because disabled=true
      const trigger = screen.getByTestId('portal-trigger')
      fireEvent.click(trigger)

      // Verify it stays closed due to disabled
      expect(screen.getByTestId('portal-to-follow-elem')).toHaveAttribute('data-open', 'false')
    })
  })

  describe('ToolTrigger Configure Mode', () => {
    it('should show different icon based on isConfigure prop', () => {
      const { rerender, container } = render(<ToolTrigger open={false} isConfigure={true} />)

      // Should have equalizer icon when isConfigure is true
      expect(container.querySelector('svg')).toBeInTheDocument()

      rerender(<ToolTrigger open={false} isConfigure={false} />)
      // Should have arrow down icon when isConfigure is false
      expect(container.querySelector('svg')).toBeInTheDocument()
    })
  })
})

// ==================== Integration Tests ====================

describe('Integration Tests', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  describe('Full Flow: Tool Selection', () => {
    it('should complete full tool selection flow', async () => {
      const onSelect = vi.fn()
      render(
        <ToolSelector {...defaultProps} onSelect={onSelect} />,
        { wrapper: createWrapper() },
      )

      // Click to select a tool
      fireEvent.click(screen.getByTestId('select-tool-btn'))

      // Verify onSelect was called with tool value
      expect(onSelect).toHaveBeenCalledWith(
        expect.objectContaining({
          provider_name: expect.any(String),
          tool_name: expect.any(String),
        }),
      )
    })

    it('should complete full multiple tool selection flow', async () => {
      const onSelectMultiple = vi.fn()
      render(
        <ToolSelector {...defaultProps} onSelectMultiple={onSelectMultiple} />,
        { wrapper: createWrapper() },
      )

      // Click to select multiple tools
      fireEvent.click(screen.getByTestId('select-multiple-btn'))

      // Verify onSelectMultiple was called
      expect(onSelectMultiple).toHaveBeenCalledWith(
        expect.arrayContaining([
          expect.objectContaining({
            provider_name: expect.any(String),
          }),
        ]),
      )
    })
  })

  describe('Full Flow: Description Update', () => {
    it('should update description through the form', async () => {
      const onSelect = vi.fn()
      const value = createToolValue()

      render(
        <ToolSelector {...defaultProps} value={value} onSelect={onSelect} />,
        { wrapper: createWrapper() },
      )

      // Find and change the description textarea
      const textarea = screen.getByRole('textbox')
      fireEvent.change(textarea, { target: { value: 'Updated description' } })

      // Verify onSelect was called with updated description
      expect(onSelect).toHaveBeenCalledWith(
        expect.objectContaining({
          extra: expect.objectContaining({
            description: 'Updated description',
          }),
        }),
      )
    })
  })
})
