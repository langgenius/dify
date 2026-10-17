import type { ReactElement } from 'react'
import { fireEvent, screen } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vite-plus/test'
import { consoleQuery } from '@/service/console'
import { createConsoleQueryClient, renderWithConsoleQuery } from '@/test/console/query-data'
import GraphIndexSetting from '../graph-index-setting'

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
        type="button"
        onClick={() => onValueChange?.({ provider: 'openai', model: 'gpt-4o-mini' })}
      >
        Select
      </button>
    </div>
  ),
}))

const ns = 'datasetSettings'
// Seed the extraction model list so rendering never reaches the network.
const render = (ui: ReactElement) => {
  const queryClient = createConsoleQueryClient()
  queryClient.setQueryData(
    consoleQuery.workspaces.current.models.modelTypes.byModelType.get.queryOptions({
      input: { params: { model_type: 'llm' } },
    }).queryKey,
    { data: [] },
  )
  return renderWithConsoleQuery(ui, { queryClient })
}
const enabled = { enabled: true, model_provider_name: 'openai', model_name: 'gpt-4o-mini' }

describe('GraphIndexSetting', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('stays collapsed until the graph is turned on', () => {
    const onChange = vi.fn()
    render(<GraphIndexSetting onGraphIndexSettingChange={onChange} />)

    expect(screen.queryByTestId('model-selector')).not.toBeInTheDocument()
    expect(screen.getByText('datasetDocuments.list.status.disabled')).toBeInTheDocument()

    fireEvent.click(screen.getByRole('switch', { name: `${ns}.form.graphIndex.title` }))

    expect(onChange).toHaveBeenCalledWith({ enabled: true })
  })

  it('states the extraction cost where the model is chosen', () => {
    render(<GraphIndexSetting graphIndexSetting={enabled} />)

    expect(screen.getByText('datasetDocuments.list.status.enabled')).toBeInTheDocument()
    expect(screen.getByTestId('current-model')).toHaveTextContent('gpt-4o-mini')
    expect(screen.getByText(`${ns}.form.graphIndex.costTip`)).toBeInTheDocument()
  })

  it('shows no model until both its provider and name are set', () => {
    render(<GraphIndexSetting graphIndexSetting={{ enabled: true, model_name: 'gpt-4o-mini' }} />)

    expect(screen.getByTestId('current-model')).toHaveTextContent('none')
  })

  it('reports the chosen extraction model', () => {
    const onChange = vi.fn()
    render(<GraphIndexSetting graphIndexSetting={enabled} onGraphIndexSettingChange={onChange} />)

    fireEvent.click(screen.getByRole('button', { name: 'Select' }))

    expect(onChange).toHaveBeenCalledWith({
      model_provider_name: 'openai',
      model_name: 'gpt-4o-mini',
    })
  })

  it('defaults to a two-hop walk with the query fallback on', () => {
    render(<GraphIndexSetting graphIndexSetting={enabled} />)

    expect(screen.getByRole('textbox', { name: `${ns}.form.graphIndex.maxDepth` })).toHaveValue('2')
    expect(
      screen.getByRole('switch', { name: `${ns}.form.graphIndex.queryFallback` }),
    ).toBeChecked()
  })

  it('reports a new traversal depth', () => {
    const onChange = vi.fn()
    render(<GraphIndexSetting graphIndexSetting={enabled} onGraphIndexSettingChange={onChange} />)
    const input = screen.getByRole('textbox', { name: `${ns}.form.graphIndex.maxDepth` })

    fireEvent.change(input, { target: { value: '3' } })
    fireEvent.blur(input)

    expect(onChange).toHaveBeenCalledWith({ max_depth: 3 })
  })

  it('falls back to the default depth when the field is cleared', () => {
    const onChange = vi.fn()
    render(
      <GraphIndexSetting
        graphIndexSetting={{ ...enabled, max_depth: 3 }}
        onGraphIndexSettingChange={onChange}
      />,
    )
    const input = screen.getByRole('textbox', { name: `${ns}.form.graphIndex.maxDepth` })

    fireEvent.change(input, { target: { value: '' } })
    fireEvent.blur(input)

    expect(onChange).toHaveBeenCalledWith({ max_depth: 2 })
  })

  it('lets the query fallback be switched off', () => {
    const onChange = vi.fn()
    render(<GraphIndexSetting graphIndexSetting={enabled} onGraphIndexSettingChange={onChange} />)

    fireEvent.click(screen.getByRole('switch', { name: `${ns}.form.graphIndex.queryFallback` }))

    expect(onChange).toHaveBeenCalledWith({ llm_query_fallback: false })
  })

  it('locks every control when read-only', () => {
    render(<GraphIndexSetting graphIndexSetting={enabled} readonly />)

    expect(screen.getByRole('switch', { name: `${ns}.form.graphIndex.title` })).toHaveAttribute(
      'aria-disabled',
      'true',
    )
    expect(screen.getByTestId('model-selector')).toHaveAttribute('data-disabled', 'true')
  })
})
