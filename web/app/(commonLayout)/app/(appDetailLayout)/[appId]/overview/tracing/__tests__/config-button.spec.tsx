import type { PopupProps } from '../config-popup'
import { fireEvent, render, screen } from '@testing-library/react'
import ConfigButton from '../config-button'
import { TracingProvider } from '../type'

vi.mock('../config-popup', () => ({
  default: ({ chosenProvider }: { chosenProvider: TracingProvider | null }) => (
    <div>{`config-popup:${chosenProvider ?? 'none'}`}</div>
  ),
}))

const createPopupProps = (overrides: Partial<PopupProps> = {}): PopupProps => ({
  appId: 'app-1',
  readOnly: false,
  enabled: false,
  onStatusChange: vi.fn(),
  chosenProvider: TracingProvider.langfuse,
  onChooseProvider: vi.fn(),
  arizeConfig: null,
  phoenixConfig: null,
  langSmithConfig: null,
  langFuseConfig: null,
  opikConfig: null,
  weaveConfig: null,
  aliyunConfig: null,
  mlflowConfig: null,
  databricksConfig: null,
  tencentConfig: null,
  onConfigUpdated: vi.fn(),
  onConfigRemoved: vi.fn(),
  ...overrides,
})

describe('OverviewRouteConfigButton', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('should return null when the button is read-only without any existing config', () => {
    const { container } = render(
      <ConfigButton
        {...createPopupProps({ readOnly: true })}
        hasConfigured={false}
      >
        <span>open-config</span>
      </ConfigButton>,
    )

    expect(container).toBeEmptyDOMElement()
  })

  it('should render and toggle the popup when clicked', () => {
    render(
      <ConfigButton
        {...createPopupProps()}
        hasConfigured={true}
      >
        <span>open-config</span>
      </ConfigButton>,
    )

    fireEvent.click(screen.getByText('open-config'))
    expect(screen.getByText('config-popup:langfuse')).toBeInTheDocument()

    fireEvent.click(screen.getByText('open-config'))
    expect(screen.queryByText('config-popup:langfuse')).not.toBeInTheDocument()
  })

  it('should still render configured content in read-only mode', () => {
    render(
      <ConfigButton
        {...createPopupProps({ readOnly: true, chosenProvider: TracingProvider.opik })}
        hasConfigured={true}
      >
        <span>configured-button</span>
      </ConfigButton>,
    )

    expect(screen.getByText('configured-button')).toBeInTheDocument()
  })
})
