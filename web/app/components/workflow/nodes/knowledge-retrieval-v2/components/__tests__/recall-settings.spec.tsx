import type { ReactNode } from 'react'
import { fireEvent, render, screen } from '@testing-library/react'
import RecallSettings from '../recall-settings'

const mockModelSelector = vi.hoisted(() => vi.fn())

vi.mock('@/app/components/header/account-setting/model-provider-page/hooks', () => ({
  useModelListAndDefaultModelAndCurrentProviderAndModel: () => ({
    currentModel: { model: 'system-rerank' },
    currentProvider: { provider: 'system/provider' },
    modelList: [{ models: [], provider: 'system/provider' }],
  }),
}))

vi.mock('@/app/components/header/account-setting/model-provider-page/model-selector', () => ({
  ModelSelector: (props: {
    onValueChange: (value: { model: string; provider: string }) => void
    value?: { model: string; provider: string }
  }) => {
    mockModelSelector(props)
    return (
      <button
        type="button"
        onClick={() => props.onValueChange({ provider: 'custom/provider', model: 'custom-rerank' })}
      >
        model-{props.value?.model}
      </button>
    )
  },
}))

vi.mock('@langgenius/dify-ui/popover', () => ({
  Popover: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  PopoverContent: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  PopoverTrigger: ({ render }: { render: ReactNode }) => <>{render}</>,
}))

vi.mock('@langgenius/dify-ui/select', () => ({
  Select: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  SelectContent: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  SelectItem: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  SelectItemIndicator: () => null,
  SelectItemText: ({ children }: { children: ReactNode }) => <>{children}</>,
  SelectTrigger: ({ children }: { children: ReactNode }) => <div>{children}</div>,
}))

vi.mock('@/app/components/base/param-item/top-k-item', () => ({
  default: (props: { onChange: (key: string, value: number) => void; value: number }) => (
    <button type="button" onClick={() => props.onChange('top_k', 20)}>
      top-{props.value}
    </button>
  ),
}))

vi.mock('@/app/components/base/param-item/score-threshold-item', () => ({
  default: (props: {
    enable: boolean
    onChange: (key: string, value: number) => void
    onSwitchChange: (key: string, enabled: boolean) => void
  }) => (
    <div>
      <button type="button" onClick={() => props.onSwitchChange('score_threshold', !props.enable)}>
        threshold-{String(props.enable)}
      </button>
      <button type="button" onClick={() => props.onChange('score_threshold', 0.73)}>
        threshold-value
      </button>
    </div>
  ),
}))

describe('RecallSettings', () => {
  it('uses the workspace default reranker until the user selects an override', () => {
    const onRerankingModelChange = vi.fn()
    const onScoreThresholdChange = vi.fn()
    const onTopKChange = vi.fn()
    render(
      <RecallSettings
        topK={10}
        scoreThreshold={null}
        onModeChange={vi.fn()}
        onRerankingModelChange={onRerankingModelChange}
        onScoreThresholdChange={onScoreThresholdChange}
        onTopKChange={onTopKChange}
      />,
    )

    expect(screen.getByText('common.modelProvider.defaultConfig')).toBeInTheDocument()
    expect(mockModelSelector).toHaveBeenLastCalledWith(
      expect.objectContaining({
        value: { provider: 'system/provider', model: 'system-rerank' },
      }),
    )
    fireEvent.click(screen.getByRole('button', { name: 'model-system-rerank' }))
    expect(onRerankingModelChange).toHaveBeenCalledWith({
      provider: 'custom/provider',
      model: 'custom-rerank',
    })

    fireEvent.click(screen.getByRole('button', { name: 'top-10' }))
    expect(onTopKChange).toHaveBeenCalledWith(20)
    fireEvent.click(screen.getByRole('button', { name: 'threshold-false' }))
    expect(onScoreThresholdChange).toHaveBeenCalledWith(0.5)
    fireEvent.click(screen.getByRole('button', { name: 'threshold-value' }))
    expect(onScoreThresholdChange).toHaveBeenCalledWith(0.73)
  })

  it('can reset an explicit reranker back to the workspace default', () => {
    const onRerankingModelChange = vi.fn()
    render(
      <RecallSettings
        topK={10}
        rerankingModel={{ provider: 'custom/provider', model: 'custom-rerank' }}
        onModeChange={vi.fn()}
        onRerankingModelChange={onRerankingModelChange}
        onScoreThresholdChange={vi.fn()}
        onTopKChange={vi.fn()}
      />,
    )

    fireEvent.click(screen.getByRole('button', { name: 'common.operation.reset' }))
    expect(onRerankingModelChange).toHaveBeenCalledWith(undefined)
  })
})
