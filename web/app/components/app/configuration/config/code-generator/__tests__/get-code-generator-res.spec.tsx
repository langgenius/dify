import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import * as React from 'react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { toast } from '@/app/components/base/ui/toast'
import { CodeLanguage } from '@/app/components/workflow/nodes/code/types'
import { STORAGE_KEYS } from '@/config/storage-keys'
import { AppModeEnum } from '@/types/app'
import { GetCodeGeneratorResModal } from '../get-code-generator-res'

const mockGenerateRule = vi.fn()
const mockStorageGet = vi.fn()
const mockStorageSet = vi.fn()

type GeneratedResult = {
  error?: string
  message?: string
  modified?: string
}

let sessionInstruction = ''
let instructionTemplateResponse: { data: string } | undefined = { data: 'Template instruction' }
let defaultModelResponse = {
  model: 'gpt-4.1-mini',
  provider: {
    provider: 'langgenius/openai/openai',
  },
}

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string) => key,
  }),
}))

vi.mock('ahooks', async () => {
  const React = await import('react')
  return {
    useBoolean: (initial: boolean) => {
      const [value, setValue] = React.useState(initial)
      return [value, { setTrue: () => setValue(true), setFalse: () => setValue(false) }]
    },
    useSessionStorageState: () => React.useState(sessionInstruction),
  }
})

vi.mock('@/app/components/base/button', () => ({
  default: ({ children, onClick, disabled }: { children: React.ReactNode, onClick?: () => void, disabled?: boolean }) => (
    <button type="button" onClick={onClick} disabled={disabled}>
      {children}
    </button>
  ),
}))

vi.mock('@/app/components/base/confirm', () => ({
  default: ({ isShow, onConfirm, onCancel }: { isShow: boolean, onConfirm: () => void, onCancel: () => void }) => {
    if (!isShow)
      return null
    return (
      <div data-testid="confirm">
        <button type="button" onClick={onConfirm}>confirm-overwrite</button>
        <button type="button" onClick={onCancel}>cancel-overwrite</button>
      </div>
    )
  },
}))

vi.mock('@/app/components/base/loading', () => ({
  default: () => <div data-testid="loading">loading</div>,
}))

vi.mock('@/app/components/base/modal', () => ({
  default: ({ isShow, children }: { isShow: boolean, children: React.ReactNode }) => isShow ? <div data-testid="modal">{children}</div> : null,
}))

vi.mock('@/app/components/base/ui/toast', () => ({
  toast: {
    success: vi.fn(),
    error: vi.fn(),
    warning: vi.fn(),
    info: vi.fn(),
  },
}))

vi.mock('@/app/components/header/account-setting/model-provider-page/hooks', () => ({
  useModelListAndDefaultModelAndCurrentProviderAndModel: () => ({
    defaultModel: defaultModelResponse,
  }),
}))

vi.mock('@/app/components/header/account-setting/model-provider-page/model-parameter-modal', () => ({
  default: ({ modelId, provider }: { modelId: string, provider: string }) => {
    return <div data-testid="model-parameter-modal" data-model={modelId} data-provider={provider} />
  },
}))

vi.mock('@/service/debug', () => ({
  generateRule: (...args: unknown[]) => mockGenerateRule(...args),
}))

vi.mock('@/service/use-apps', () => ({
  useGenerateRuleTemplate: () => ({
    data: instructionTemplateResponse,
  }),
}))

vi.mock('@/utils/storage', () => ({
  storage: {
    get: (...args: unknown[]) => mockStorageGet(...args),
    set: (...args: unknown[]) => mockStorageSet(...args),
  },
}))

vi.mock('@/app/components/workflow/nodes/_base/components/editor/code-editor/index', () => ({
  languageMap: {
    python3: 'python',
  },
}))

vi.mock('@/app/components/app/configuration/config/automatic/idea-output', () => ({
  default: ({ value, onChange }: { value: string, onChange: (value: string) => void }) => (
    <input aria-label="idea-output" value={value} onChange={e => onChange(e.target.value)} />
  ),
}))

vi.mock('@/app/components/app/configuration/config/automatic/instruction-editor-in-workflow', () => ({
  default: ({ value, onChange }: { value: string, onChange: (value: string) => void }) => (
    <textarea aria-label="instruction-editor" value={value} onChange={e => onChange(e.target.value)} />
  ),
}))

vi.mock('@/app/components/app/configuration/config/automatic/res-placeholder', () => ({
  default: () => <div data-testid="placeholder">placeholder</div>,
}))

vi.mock('@/app/components/app/configuration/config/automatic/result', () => ({
  default: ({ current, onApply }: { current: { modified?: string }, onApply: () => void }) => (
    <div data-testid="result">
      <div>{current.modified}</div>
      <button type="button" onClick={onApply}>apply-result</button>
    </div>
  ),
}))

vi.mock('@/app/components/app/configuration/config/automatic/use-gen-data', async () => {
  const React = await import('react')

  const useMockGenData = () => {
    const [versions, setVersions] = React.useState<GeneratedResult[]>([])
    const [currentVersionIndex, setCurrentVersionIndex] = React.useState<number | undefined>(undefined)
    const current = versions.length
      ? versions[currentVersionIndex ?? versions.length - 1]
      : undefined

    return {
      addVersion: (res: GeneratedResult) => {
        setVersions(prev => [...prev, res])
        setCurrentVersionIndex(undefined)
      },
      current,
      currentVersionIndex,
      setCurrentVersionIndex,
      versions,
    }
  }

  return {
    default: useMockGenData,
  }
})

const renderModal = (overrides: Partial<React.ComponentProps<typeof GetCodeGeneratorResModal>> = {}) => {
  return render(
    <GetCodeGeneratorResModal
      codeLanguages={CodeLanguage.python3}
      flowId="flow-1"
      isShow
      mode={AppModeEnum.CHAT}
      nodeId="node-1"
      onClose={vi.fn()}
      onFinished={vi.fn()}
      {...overrides}
    />,
  )
}

describe('GetCodeGeneratorResModal', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    sessionInstruction = ''
    defaultModelResponse = {
      model: 'gpt-4.1-mini',
      provider: {
        provider: 'langgenius/openai/openai',
      },
    }
    instructionTemplateResponse = { data: 'Template instruction' }
    mockStorageGet.mockImplementation((key: string) => {
      if (key === STORAGE_KEYS.LOCAL.GENERATOR.AUTO_GEN_MODEL)
        return null
      return null
    })
  })

  it('should hydrate instruction and fall back to the default model', async () => {
    renderModal()

    await waitFor(() => {
      expect(screen.getByLabelText('instruction-editor')).toHaveValue('Template instruction')
    })

    expect(screen.getByTestId('model-parameter-modal')).toHaveAttribute('data-model', 'gpt-4.1-mini')
    expect(screen.getByTestId('model-parameter-modal')).toHaveAttribute('data-provider', 'langgenius/openai/openai')
  })

  it('should validate empty instruction before requesting code generation', () => {
    instructionTemplateResponse = undefined

    renderModal()
    fireEvent.click(screen.getByRole('button', { name: 'codegen.generate' }))

    expect(toast.error).toHaveBeenCalledWith('errorMsg.fieldRequired')
    expect(mockGenerateRule).not.toHaveBeenCalled()
  })

  it('should generate code, show loading, and confirm overwrite before finishing', async () => {
    sessionInstruction = 'Generate a parser'
    const onFinished = vi.fn()
    let resolveRequest!: (value: GeneratedResult) => void
    mockGenerateRule.mockReturnValue(new Promise(resolve => resolveRequest = resolve))

    renderModal({ onFinished })

    fireEvent.click(screen.getByRole('button', { name: 'codegen.generate' }))
    expect(screen.getByTestId('loading')).toBeInTheDocument()

    await act(async () => {
      resolveRequest({ modified: 'print("done")', message: 'Generated' })
    })

    await waitFor(() => {
      expect(screen.getByTestId('result')).toHaveTextContent('print("done")')
    })

    fireEvent.click(screen.getByRole('button', { name: 'apply-result' }))
    expect(screen.getByTestId('confirm')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'confirm-overwrite' }))

    expect(onFinished).toHaveBeenCalledWith(expect.objectContaining({
      modified: 'print("done")',
    }))
  })

  it('should show the backend error without appending a new version', async () => {
    sessionInstruction = 'Generate a parser'
    mockGenerateRule.mockResolvedValue({ error: 'generation failed' })

    renderModal()
    fireEvent.click(screen.getByRole('button', { name: 'codegen.generate' }))

    await waitFor(() => {
      expect(toast.error).toHaveBeenCalledWith('generation failed')
    })

    expect(screen.getByTestId('placeholder')).toBeInTheDocument()
    expect(screen.queryByTestId('result')).not.toBeInTheDocument()
  })
})
