import type { ModerationContentConfig } from '@/models/debug'
import { fireEvent, render, screen } from '@testing-library/react'
import ModerationContent from './moderation-content'

const defaultConfig: ModerationContentConfig = {
  enabled: false,
  preset_response: '',
}

const renderComponent = (props: Partial<{
  title: string
  info: string
  showPreset: boolean
  config: ModerationContentConfig
  onConfigChange: (config: ModerationContentConfig) => void
}> = {}) => {
  const onConfigChange = props.onConfigChange ?? vi.fn()
  return render(
    <ModerationContent
      title={props.title ?? 'Test Title'}
      info={props.info}
      showPreset={props.showPreset}
      config={props.config ?? defaultConfig}
      onConfigChange={onConfigChange}
    />,
  )
}

describe('ModerationContent', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('should render the title', () => {
    renderComponent({ title: 'Input Content' })

    expect(screen.getByText('Input Content')).toBeInTheDocument()
  })

  it('should render info text when provided', () => {
    renderComponent({ info: 'Some info text' })

    expect(screen.getByText('Some info text')).toBeInTheDocument()
  })

  it('should not render info when not provided', () => {
    renderComponent()

    // When info is not provided, only the title "Test Title" should be shown
    expect(screen.getByText(/Test Title/)).toBeInTheDocument()
    expect(screen.queryByText(/Some info text/)).not.toBeInTheDocument()
  })

  it('should render a switch toggle', () => {
    renderComponent()

    expect(screen.getByRole('switch')).toBeInTheDocument()
  })

  it('should call onConfigChange with enabled true when switch is toggled on', () => {
    const onConfigChange = vi.fn()
    renderComponent({ onConfigChange })

    fireEvent.click(screen.getByRole('switch'))

    expect(onConfigChange).toHaveBeenCalledWith({ ...defaultConfig, enabled: true })
  })

  it('should show preset textarea when enabled and showPreset is true', () => {
    renderComponent({
      config: { enabled: true, preset_response: '' },
      showPreset: true,
    })

    expect(screen.getByText(/feature\.moderation\.modal\.content\.preset/)).toBeInTheDocument()
    expect(screen.getByRole('textbox')).toBeInTheDocument()
  })

  it('should not show preset textarea when showPreset is false', () => {
    renderComponent({
      config: { enabled: true, preset_response: '' },
      showPreset: false,
    })

    expect(screen.queryByRole('textbox')).not.toBeInTheDocument()
  })

  it('should call onConfigChange when preset_response is changed', () => {
    const onConfigChange = vi.fn()
    renderComponent({
      config: { enabled: true, preset_response: '' },
      onConfigChange,
    })

    fireEvent.change(screen.getByRole('textbox'), { target: { value: 'test response' } })

    expect(onConfigChange).toHaveBeenCalledWith({
      enabled: true,
      preset_response: 'test response',
    })
  })

  it('should truncate preset_response to 100 characters', () => {
    const onConfigChange = vi.fn()
    const longText = 'a'.repeat(150)
    renderComponent({
      config: { enabled: true, preset_response: '' },
      onConfigChange,
    })

    fireEvent.change(screen.getByRole('textbox'), { target: { value: longText } })

    expect(onConfigChange).toHaveBeenCalledWith({
      enabled: true,
      preset_response: 'a'.repeat(100),
    })
  })

  it('should display character count', () => {
    renderComponent({
      config: { enabled: true, preset_response: 'hello' },
    })

    expect(screen.getByText('5')).toBeInTheDocument()
    expect(screen.getByText('100')).toBeInTheDocument()
  })
})
