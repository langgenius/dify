import type { Limit } from '../../types'
import { fireEvent, render, screen } from '@testing-library/react'
import LimitConfig from '../limit-config'

type MockSwitchProps = {
  checked: boolean
  onCheckedChange: (value: boolean) => void
  disabled?: boolean
}

type MockSliderProps = {
  value: number
  min: number
  max: number
  onChange: (value: number | string) => void
  readonly: boolean
}

const mockSwitch = vi.fn<(props: MockSwitchProps) => void>()
const mockSlider = vi.fn<(props: MockSliderProps) => void>()

vi.mock('@/app/components/base/switch', () => ({
  default: (props: MockSwitchProps) => {
    mockSwitch(props)
    return (
      <button
        type="button"
        onClick={() => !props.disabled && props.onCheckedChange(!props.checked)}
      >
        {`switch:${props.checked}`}
      </button>
    )
  },
}))

vi.mock('@/app/components/workflow/nodes/_base/components/field', () => ({
  default: ({
    title,
    operations,
    children,
  }: {
    title: string
    operations?: React.ReactNode
    children?: React.ReactNode
  }) => (
    <div>
      <div>{title}</div>
      <div>{operations}</div>
      <div>{children}</div>
    </div>
  ),
}))

vi.mock('@/app/components/workflow/nodes/_base/components/input-number-with-slider', () => ({
  default: (props: MockSliderProps) => {
    mockSlider(props)
    return (
      <button type="button" onClick={() => props.onChange('7')}>
        {`slider:${props.value}:${props.readonly}`}
      </button>
    )
  },
}))

describe('list-operator/limit-config', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('should enable limit mode from a disabled config', () => {
    const handleChange = vi.fn()
    const config: Limit = { enabled: false, size: 10 }

    render(
      <LimitConfig
        readonly={false}
        config={config}
        onChange={handleChange}
      />,
    )

    expect(screen.getByText('workflow.nodes.listFilter.limit'))!.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'slider:10:false' })).not.toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: 'switch:false' }))
    expect(handleChange).toHaveBeenCalledWith({
      enabled: true,
      size: 10,
    })
  })

  it('should change the limit size and disable toggling when readonly', () => {
    const handleChange = vi.fn()
    const config: Limit = { enabled: true, size: 6 }

    render(
      <LimitConfig
        className="custom-limit"
        readonly
        config={config}
        onChange={handleChange}
      />,
    )

    expect(screen.getByRole('button', { name: 'slider:6:true' }))!.toBeInTheDocument()
    expect(mockSlider.mock.calls[0]![0]).toMatchObject({
      value: 6,
      min: 1,
      max: 20,
      readonly: true,
    })

    fireEvent.click(screen.getByRole('button', { name: 'slider:6:true' }))
    expect(handleChange).toHaveBeenCalledWith({
      enabled: true,
      size: 7,
    })

    fireEvent.click(screen.getByRole('button', { name: 'switch:true' }))
    expect(handleChange).toHaveBeenCalledTimes(1)
  })
})
