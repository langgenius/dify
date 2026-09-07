import { fireEvent, render, screen } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vite-plus/test'
import SummaryIndexSetting from '../summary-index-setting'

// Mock useModelList to return a list of text generation models
vi.mock('@/app/components/header/account-setting/model-provider-page/hooks', () => ({
  useModelList: () => ({
    data: [
      {
        provider: 'openai',
        label: { en_US: 'OpenAI' },
        models: [
          { model: 'gpt-4', label: { en_US: 'GPT-4' }, model_type: 'llm', status: 'active' },
        ],
      },
    ],
  }),
}))

// Mock ModelSelector (external component from header module)
vi.mock('@/app/components/header/account-setting/model-provider-page/model-selector', () => ({
  ModelSelector: ({
    onValueChange,
    disabled,
    value,
  }: {
    onValueChange?: (val: Record<string, string>) => void
    disabled?: boolean
    value?: { model?: string }
  }) => (
    <div data-testid="model-selector" data-disabled={disabled}>
      <span data-testid="current-model">{value?.model || 'none'}</span>
      <button
        data-testid="select-model-btn"
        onClick={() => onValueChange?.({ provider: 'openai', model: 'gpt-4' })}
      >
        Select
      </button>
    </div>
  ),
}))

const ns = 'datasetSettings'

describe('SummaryIndexSetting', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  describe('knowledge-base entry', () => {
    it('should render auto gen label and switch', () => {
      render(<SummaryIndexSetting entry="knowledge-base" />)
      expect(screen.getByText(`${ns}.form.summaryAutoGen`)).toBeInTheDocument()
    })

    it('should render switch with defaultValue false when no setting', () => {
      render(<SummaryIndexSetting entry="knowledge-base" />)
      // Switch is rendered; no model selector without enable
      expect(screen.queryByTestId('model-selector')).not.toBeInTheDocument()
    })

    it('should show model selector and textarea when enabled', () => {
      render(
        <SummaryIndexSetting
          entry="knowledge-base"
          summaryIndexSetting={{
            enable: true,
            model_provider_name: 'openai',
            model_name: 'gpt-4',
          }}
        />,
      )
      expect(screen.getByTestId('model-selector')).toBeInTheDocument()
      expect(screen.getByText(`${ns}.form.summaryModel`)).toBeInTheDocument()
      expect(screen.getByText(`${ns}.form.summaryInstructions`)).toBeInTheDocument()
    })

    it('should call onSummaryIndexSettingChange with enable toggle', () => {
      const onChange = vi.fn()
      render(
        <SummaryIndexSetting
          entry="knowledge-base"
          summaryIndexSetting={{ enable: false }}
          onSummaryIndexSettingChange={onChange}
        />,
      )
      // Find and click the switch
      const switchEl = screen.getByRole('switch')
      fireEvent.click(switchEl)
      expect(onChange).toHaveBeenCalledWith({ enable: true })
    })

    it('should call onSummaryIndexSettingChange when model selected', () => {
      const onChange = vi.fn()
      render(
        <SummaryIndexSetting
          entry="knowledge-base"
          summaryIndexSetting={{ enable: true, model_provider_name: 'openai', model_name: 'gpt-4' }}
          onSummaryIndexSettingChange={onChange}
        />,
      )
      fireEvent.click(screen.getByTestId('select-model-btn'))
      expect(onChange).toHaveBeenCalledWith({ model_provider_name: 'openai', model_name: 'gpt-4' })
    })

    it('should call onSummaryIndexSettingChange when prompt changed', () => {
      const onChange = vi.fn()
      render(
        <SummaryIndexSetting
          entry="knowledge-base"
          summaryIndexSetting={{ enable: true, summary_prompt: '' }}
          onSummaryIndexSettingChange={onChange}
        />,
      )
      const textarea = screen.getByPlaceholderText(`${ns}.form.summaryInstructionsPlaceholder`)
      fireEvent.change(textarea, { target: { value: 'Summarize this' } })
      expect(onChange).toHaveBeenCalledWith({ summary_prompt: 'Summarize this' })
    })
  })

  describe('dataset-settings entry', () => {
    it('should render auto gen label with switch', () => {
      render(<SummaryIndexSetting entry="dataset-settings" />)
      expect(screen.getByText(`${ns}.form.summaryAutoGen`)).toBeInTheDocument()
    })

    it('should show disabled text when not enabled', () => {
      render(
        <SummaryIndexSetting entry="dataset-settings" summaryIndexSetting={{ enable: false }} />,
      )
      expect(screen.getByText(`${ns}.form.summaryAutoGenEnableTip`)).toBeInTheDocument()
    })

    it('should show enabled tip when enabled', () => {
      render(
        <SummaryIndexSetting entry="dataset-settings" summaryIndexSetting={{ enable: true }} />,
      )
      expect(screen.getByText(`${ns}.form.summaryAutoGenTip`)).toBeInTheDocument()
    })

    it('should show model selector and textarea when enabled', () => {
      render(
        <SummaryIndexSetting
          entry="dataset-settings"
          summaryIndexSetting={{ enable: true, model_provider_name: 'openai', model_name: 'gpt-4' }}
        />,
      )
      expect(screen.getByTestId('model-selector')).toBeInTheDocument()
      expect(screen.getByText(`${ns}.form.summaryModel`)).toBeInTheDocument()
    })
  })

  describe('create-document entry', () => {
    it('should render auto gen label with switch', () => {
      render(<SummaryIndexSetting entry="create-document" />)
      expect(screen.getByText(`${ns}.form.summaryAutoGen`)).toBeInTheDocument()
    })

    it('should show model selector and textarea when enabled', () => {
      render(
        <SummaryIndexSetting
          entry="create-document"
          summaryIndexSetting={{ enable: true, model_provider_name: 'openai', model_name: 'gpt-4' }}
        />,
      )
      expect(screen.getByTestId('model-selector')).toBeInTheDocument()
      expect(screen.getByText(`${ns}.form.summaryModel`)).toBeInTheDocument()
      expect(screen.getByText(`${ns}.form.summaryInstructions`)).toBeInTheDocument()
    })

    it('should not show model selector when disabled', () => {
      render(
        <SummaryIndexSetting entry="create-document" summaryIndexSetting={{ enable: false }} />,
      )
      expect(screen.queryByTestId('model-selector')).not.toBeInTheDocument()
    })
  })

  describe('readonly mode', () => {
    it('should disable model selector in knowledge-base entry', () => {
      render(
        <SummaryIndexSetting
          entry="knowledge-base"
          summaryIndexSetting={{ enable: true, model_provider_name: 'openai', model_name: 'gpt-4' }}
          readonly
        />,
      )
      expect(screen.getByTestId('model-selector')).toHaveAttribute('data-disabled', 'true')
    })

    it('should disable textarea in readonly mode', () => {
      render(
        <SummaryIndexSetting
          entry="knowledge-base"
          summaryIndexSetting={{ enable: true, summary_prompt: 'test' }}
          readonly
        />,
      )
      const textarea = screen.getByPlaceholderText(`${ns}.form.summaryInstructionsPlaceholder`)
      expect(textarea).toBeDisabled()
    })
  })

  describe('model config derivation', () => {
    it('should pass the selected value when provider and model are set', () => {
      render(
        <SummaryIndexSetting
          entry="knowledge-base"
          summaryIndexSetting={{
            enable: true,
            model_provider_name: 'anthropic',
            model_name: 'claude-3',
          }}
        />,
      )
      expect(screen.getByTestId('current-model')).toHaveTextContent('claude-3')
    })

    it('should pass an undefined value when provider is missing', () => {
      render(<SummaryIndexSetting entry="knowledge-base" summaryIndexSetting={{ enable: true }} />)
      expect(screen.getByTestId('current-model')).toHaveTextContent('none')
    })
  })
})
