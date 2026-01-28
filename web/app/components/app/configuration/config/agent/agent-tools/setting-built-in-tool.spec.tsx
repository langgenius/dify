import type { Tool, ToolParameter } from '@/app/components/tools/types'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import * as React from 'react'
import { CollectionType } from '@/app/components/tools/types'
import SettingBuiltInTool from './setting-built-in-tool'

const fetchModelToolList = vi.fn()
const fetchBuiltInToolList = vi.fn()
const fetchCustomToolList = vi.fn()
const fetchWorkflowToolList = vi.fn()
vi.mock('@/service/tools', () => ({
  fetchModelToolList: (collectionName: string) => fetchModelToolList(collectionName),
  fetchBuiltInToolList: (collectionName: string) => fetchBuiltInToolList(collectionName),
  fetchCustomToolList: (collectionName: string) => fetchCustomToolList(collectionName),
  fetchWorkflowToolList: (appId: string) => fetchWorkflowToolList(appId),
}))

type MockFormProps = {
  value: Record<string, any>
  onChange: (val: Record<string, any>) => void
}
let nextFormValue: Record<string, any> = {}
const FormMock = ({ value, onChange }: MockFormProps) => {
  return (
    <div data-testid="mock-form">
      <div data-testid="form-value">{JSON.stringify(value)}</div>
      <button
        type="button"
        onClick={() => onChange({ ...value, ...nextFormValue })}
      >
        update-form
      </button>
    </div>
  )
}
vi.mock('@/app/components/header/account-setting/model-provider-page/model-modal/Form', () => ({
  default: (props: MockFormProps) => <FormMock {...props} />,
}))

let pluginAuthClickValue = 'credential-from-plugin'
vi.mock('@/app/components/plugins/plugin-auth', () => ({
  AuthCategory: { tool: 'tool' },
  PluginAuthInAgent: (props: { onAuthorizationItemClick?: (id: string) => void }) => (
    <div data-testid="plugin-auth">
      <button type="button" onClick={() => props.onAuthorizationItemClick?.(pluginAuthClickValue)}>
        choose-plugin-credential
      </button>
    </div>
  ),
}))

vi.mock('@/app/components/plugins/readme-panel/entrance', () => ({
  ReadmeEntrance: ({ className }: { className?: string }) => <div className={className}>readme</div>,
}))

vi.mock('@/context/i18n', () => ({
  useLocale: vi.fn(() => 'en-US'),
}))

const createParameter = (overrides?: Partial<ToolParameter>): ToolParameter => ({
  name: 'settingParam',
  label: {
    en_US: 'Setting Param',
    zh_Hans: 'Setting Param',
  },
  human_description: {
    en_US: 'desc',
    zh_Hans: 'desc',
  },
  type: 'string',
  form: 'config',
  llm_description: '',
  required: true,
  multiple: false,
  default: '',
  ...overrides,
})

const createTool = (overrides?: Partial<Tool>): Tool => ({
  name: 'search',
  author: 'tester',
  label: {
    en_US: 'Search Tool',
    zh_Hans: 'Search Tool',
  },
  description: {
    en_US: 'tool description',
    zh_Hans: 'tool description',
  },
  parameters: [
    createParameter({
      name: 'infoParam',
      label: {
        en_US: 'Info Param',
        zh_Hans: 'Info Param',
      },
      form: 'llm',
      required: false,
    }),
    createParameter(),
  ],
  labels: [],
  output_schema: {},
  ...overrides,
})

const baseCollection = {
  id: 'provider-1',
  name: 'vendor/provider-1',
  author: 'tester',
  description: {
    en_US: 'desc',
    zh_Hans: 'desc',
  },
  icon: 'https://example.com/icon.png',
  label: {
    en_US: 'Provider Label',
    zh_Hans: 'Provider Label',
  },
  type: CollectionType.builtIn,
  team_credentials: {},
  is_team_authorization: true,
  allow_delete: true,
  labels: [],
  tools: [createTool()],
}

const renderComponent = (props?: Partial<React.ComponentProps<typeof SettingBuiltInTool>>) => {
  const onHide = vi.fn()
  const onSave = vi.fn()
  const onAuthorizationItemClick = vi.fn()
  const utils = render(
    <SettingBuiltInTool
      collection={baseCollection as any}
      toolName="search"
      isModel
      setting={{ settingParam: 'value' }}
      onHide={onHide}
      onSave={onSave}
      onAuthorizationItemClick={onAuthorizationItemClick}
      {...props}
    />,
  )
  return {
    ...utils,
    onHide,
    onSave,
    onAuthorizationItemClick,
  }
}

describe('SettingBuiltInTool', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    nextFormValue = {}
    pluginAuthClickValue = 'credential-from-plugin'
  })

  it('should fetch tool list when collection has no tools', async () => {
    fetchModelToolList.mockResolvedValueOnce([createTool()])
    renderComponent({
      collection: {
        ...baseCollection,
        tools: [],
      },
    })

    await waitFor(() => {
      expect(fetchModelToolList).toHaveBeenCalledTimes(1)
      expect(fetchModelToolList).toHaveBeenCalledWith('vendor/provider-1')
    })
    expect(await screen.findByText('Search Tool')).toBeInTheDocument()
  })

  it('should switch between info and setting tabs', async () => {
    renderComponent()
    await waitFor(() => {
      expect(screen.getByTestId('mock-form')).toBeInTheDocument()
    })

    await userEvent.click(screen.getByText('tools.setBuiltInTools.parameters'))
    expect(screen.getByText('Info Param')).toBeInTheDocument()
    await userEvent.click(screen.getByText('tools.setBuiltInTools.setting'))
    expect(screen.getByTestId('mock-form')).toBeInTheDocument()
  })

  it('should call onSave with updated values when save button clicked', async () => {
    const { onSave } = renderComponent()
    await waitFor(() => expect(screen.getByTestId('mock-form')).toBeInTheDocument())
    nextFormValue = { settingParam: 'updated' }
    await userEvent.click(screen.getByRole('button', { name: 'update-form' }))
    await userEvent.click(screen.getByRole('button', { name: 'common.operation.save' }))
    expect(onSave).toHaveBeenCalledWith(expect.objectContaining({ settingParam: 'updated' }))
  })

  it('should keep save disabled until required field provided', async () => {
    renderComponent({
      setting: {},
    })
    await waitFor(() => expect(screen.getByTestId('mock-form')).toBeInTheDocument())
    const saveButton = screen.getByRole('button', { name: 'common.operation.save' })
    expect(saveButton).toBeDisabled()
    nextFormValue = { settingParam: 'filled' }
    await userEvent.click(screen.getByRole('button', { name: 'update-form' }))
    expect(saveButton).not.toBeDisabled()
  })

  it('should call onHide when cancel button is pressed', async () => {
    const { onHide } = renderComponent()
    await waitFor(() => expect(screen.getByTestId('mock-form')).toBeInTheDocument())
    await userEvent.click(screen.getByRole('button', { name: 'common.operation.cancel' }))
    expect(onHide).toHaveBeenCalled()
  })

  it('should trigger authorization callback from plugin auth section', async () => {
    const { onAuthorizationItemClick } = renderComponent()
    await userEvent.click(screen.getByRole('button', { name: 'choose-plugin-credential' }))
    expect(onAuthorizationItemClick).toHaveBeenCalledWith('credential-from-plugin')
  })

  it('should call onHide when back button is clicked', async () => {
    const { onHide } = renderComponent({
      showBackButton: true,
    })
    await userEvent.click(screen.getByText('plugin.detailPanel.operation.back'))
    expect(onHide).toHaveBeenCalled()
  })

  it('should load workflow tools when workflow collection is provided', async () => {
    fetchWorkflowToolList.mockResolvedValueOnce([createTool({
      name: 'workflow-tool',
    })])
    renderComponent({
      collection: {
        ...baseCollection,
        type: CollectionType.workflow,
        tools: [],
        id: 'workflow-1',
      } as any,
      isBuiltIn: false,
      isModel: false,
    })

    await waitFor(() => {
      expect(fetchWorkflowToolList).toHaveBeenCalledWith('workflow-1')
    })
  })
})
