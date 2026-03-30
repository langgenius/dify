import type { ExternalDataTool } from '@/models/common'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { toast } from '@/app/components/base/ui/toast'
import ExternalDataToolModal from '../external-data-tool-modal'

let mockLocale = 'en-US'

vi.mock('@/app/components/base/app-icon', () => ({
  default: ({
    icon,
    onClick,
  }: {
    icon?: string
    onClick?: () => void
  }) => (
    <button data-testid="app-icon" onClick={onClick}>
      {icon || 'empty-icon'}
    </button>
  ),
}))

vi.mock('@/app/components/base/emoji-picker', () => ({
  default: ({
    onClose,
    onSelect,
  }: {
    onClose: () => void
    onSelect: (icon: string, iconBackground: string) => void
  }) => (
    <div data-testid="emoji-picker">
      <button onClick={() => onSelect('😎', '#000000')}>select-emoji</button>
      <button onClick={onClose}>close-emoji</button>
    </div>
  ),
}))

vi.mock('@/app/components/base/features/new-feature-panel/moderation/form-generation', () => ({
  default: ({
    onChange,
  }: {
    onChange: (value: Record<string, string>) => void
  }) => <button onClick={() => onChange({ region: 'us' })}>fill-form</button>,
}))

vi.mock('@/app/components/base/ui/dialog', () => ({
  Dialog: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  DialogContent: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
}))

vi.mock('@/app/components/base/ui/select', () => ({
  Select: ({
    children,
    onValueChange,
  }: {
    children: React.ReactNode
    onValueChange?: (value: string) => void
  }) => (
    <div>
      {children}
      <button onClick={() => onValueChange?.('custom-tool')}>select-custom-tool</button>
      <button onClick={() => onValueChange?.('api')}>select-api</button>
    </div>
  ),
  SelectContent: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  SelectItem: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  SelectTrigger: ({
    children,
    ...props
  }: React.ButtonHTMLAttributes<HTMLButtonElement>) => <button {...props}>{children}</button>,
  SelectValue: () => <span>select-value</span>,
}))

vi.mock('@/app/components/base/ui/toast', () => ({
  toast: {
    error: vi.fn(),
  },
}))

vi.mock('@/app/components/header/account-setting/api-based-extension-page/selector', () => ({
  default: ({ onChange }: { onChange: (value: string) => void }) => (
    <button onClick={() => onChange('extension-1')}>select-api-extension</button>
  ),
}))

vi.mock('@/context/i18n', () => ({
  useDocLink: () => (path: string) => `https://docs.example.com${path}`,
  useLocale: () => mockLocale,
}))

vi.mock('@/service/use-common', () => ({
  useCodeBasedExtensions: () => ({
    data: {
      data: [{
        form_schema: [{
          default: 'default-region',
          label: {
            'en-US': 'Region',
            'zh-Hans': '地区',
          },
          required: true,
          variable: 'region',
        }],
        label: {
          'en-US': 'Custom Tool',
          'zh-Hans': '自定义工具',
        },
        name: 'custom-tool',
      }],
    },
  }),
}))

describe('ExternalDataToolModal', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockLocale = 'en-US'
  })

  it('should save api-based tools after validating the selected extension', async () => {
    const user = userEvent.setup()
    const onSave = vi.fn()
    const onValidateBeforeSave = vi.fn().mockReturnValue(true)

    render(
      <ExternalDataToolModal
        data={{} as ExternalDataTool}
        onCancel={vi.fn()}
        onSave={onSave}
        onValidateBeforeSave={onValidateBeforeSave}
      />,
    )

    expect(screen.getByRole('link', { name: 'common.apiBasedExtension.link' })).toHaveAttribute(
      'href',
      'https://docs.example.com/use-dify/workspace/api-extension/api-extension',
    )

    await user.type(screen.getByPlaceholderText('appDebug.feature.tools.modal.name.placeholder'), 'Search tool')
    await user.type(screen.getByPlaceholderText('appDebug.feature.tools.modal.variableName.placeholder'), 'search_tool')
    await user.click(screen.getByText('select-api-extension'))
    await user.click(screen.getByRole('button', { name: 'common.operation.save' }))

    expect(onValidateBeforeSave).toHaveBeenCalledWith(expect.objectContaining({
      config: {
        api_based_extension_id: 'extension-1',
      },
      enabled: true,
      label: 'Search tool',
      type: 'api',
      variable: 'search_tool',
    }))
    expect(onSave).toHaveBeenCalledWith(expect.objectContaining({
      config: {
        api_based_extension_id: 'extension-1',
      },
      enabled: true,
      label: 'Search tool',
      type: 'api',
      variable: 'search_tool',
    }))
  })

  it('should reject invalid variable names before save', async () => {
    const user = userEvent.setup()

    render(
      <ExternalDataToolModal
        data={{} as ExternalDataTool}
        onCancel={vi.fn()}
        onSave={vi.fn()}
      />,
    )

    await user.type(screen.getByPlaceholderText('appDebug.feature.tools.modal.name.placeholder'), 'Search tool')
    await user.type(screen.getByPlaceholderText('appDebug.feature.tools.modal.variableName.placeholder'), 'invalid-key!')
    await user.click(screen.getByRole('button', { name: 'common.operation.save' }))

    expect(toast.error).toHaveBeenCalledWith(expect.stringContaining('notValid'))
  })

  it('should allow selecting emojis and saving custom providers with generated form data', async () => {
    const user = userEvent.setup()
    const onSave = vi.fn()

    render(
      <ExternalDataToolModal
        data={{} as ExternalDataTool}
        onCancel={vi.fn()}
        onSave={onSave}
      />,
    )

    await user.click(screen.getByText('select-custom-tool'))
    await user.type(screen.getByPlaceholderText('appDebug.feature.tools.modal.name.placeholder'), 'Custom tool')
    await user.type(screen.getByPlaceholderText('appDebug.feature.tools.modal.variableName.placeholder'), 'custom_tool')
    await user.click(screen.getByTestId('app-icon'))
    await user.click(screen.getByText('select-emoji'))
    await user.click(screen.getByText('fill-form'))
    await user.click(screen.getByRole('button', { name: 'common.operation.save' }))

    expect(onSave).toHaveBeenCalledWith(expect.objectContaining({
      config: {
        region: 'us',
      },
      enabled: true,
      icon: '😎',
      icon_background: '#000000',
      type: 'custom-tool',
      variable: 'custom_tool',
    }))
  })

  it('should stop before saving when the caller rejects the formatted payload', async () => {
    const user = userEvent.setup()
    const onSave = vi.fn()
    const onValidateBeforeSave = vi.fn().mockReturnValue(false)

    render(
      <ExternalDataToolModal
        data={{} as ExternalDataTool}
        onCancel={vi.fn()}
        onSave={onSave}
        onValidateBeforeSave={onValidateBeforeSave}
      />,
    )

    await user.type(screen.getByPlaceholderText('appDebug.feature.tools.modal.name.placeholder'), 'Search tool')
    await user.type(screen.getByPlaceholderText('appDebug.feature.tools.modal.variableName.placeholder'), 'search_tool')
    await user.click(screen.getByText('select-api-extension'))
    await user.click(screen.getByRole('button', { name: 'common.operation.save' }))

    expect(onValidateBeforeSave).toHaveBeenCalledTimes(1)
    expect(onSave).not.toHaveBeenCalled()
  })
})
