import { fireEvent, render, screen } from '@testing-library/react'
import ProviderPanel from '../provider-panel'
import { TracingProvider } from '../type'

describe('OverviewRouteProviderPanel', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.spyOn(window, 'open').mockImplementation(() => null)
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('should render provider description and open the config action', () => {
    const onConfig = vi.fn()

    render(
      <ProviderPanel
        type={TracingProvider.langfuse}
        readOnly={false}
        isChosen={false}
        config={null}
        hasConfigured={false}
        onChoose={vi.fn()}
        onConfig={onConfig}
      />,
    )

    expect(screen.getByText('app.tracing.langfuse.description')).toBeInTheDocument()

    fireEvent.click(screen.getByText('app.tracing.config'))

    expect(onConfig).toHaveBeenCalledTimes(1)
  })

  it('should open the provider project page when view is clicked', () => {
    render(
      <ProviderPanel
        type={TracingProvider.langSmith}
        readOnly={false}
        isChosen={false}
        config={{ project_url: 'https://example.com/project' }}
        hasConfigured={true}
        onChoose={vi.fn()}
        onConfig={vi.fn()}
      />,
    )

    fireEvent.click(screen.getByText('app.tracing.view'))

    expect(window.open).toHaveBeenCalledWith('https://example.com/project', '_blank', 'noopener,noreferrer')
  })

  it('should choose a configured provider when it is clickable', () => {
    const onChoose = vi.fn()

    render(
      <ProviderPanel
        type={TracingProvider.opik}
        readOnly={false}
        isChosen={false}
        config={{}}
        hasConfigured={true}
        onChoose={onChoose}
        onConfig={vi.fn()}
      />,
    )

    fireEvent.click(screen.getByText('app.tracing.opik.description'))

    expect(onChoose).toHaveBeenCalledTimes(1)
  })

  it('should ignore choose clicks when the provider is read-only, chosen, or not configured', () => {
    const onChoose = vi.fn()

    const { rerender } = render(
      <ProviderPanel
        type={TracingProvider.weave}
        readOnly={true}
        isChosen={false}
        config={{}}
        hasConfigured={true}
        onChoose={onChoose}
        onConfig={vi.fn()}
      />,
    )

    fireEvent.click(screen.getByText('app.tracing.weave.description'))

    rerender(
      <ProviderPanel
        type={TracingProvider.weave}
        readOnly={false}
        isChosen={true}
        config={{}}
        hasConfigured={true}
        onChoose={onChoose}
        onConfig={vi.fn()}
      />,
    )

    fireEvent.click(screen.getByText('app.tracing.inUse'))

    rerender(
      <ProviderPanel
        type={TracingProvider.weave}
        readOnly={false}
        isChosen={false}
        config={{}}
        hasConfigured={false}
        onChoose={onChoose}
        onConfig={vi.fn()}
      />,
    )

    fireEvent.click(screen.getByText('app.tracing.weave.description'))

    expect(onChoose).not.toHaveBeenCalled()
  })
})
