import { render } from '@testing-library/react'
import { API_PREFIX } from '@/config'
import BlockIcon, { VarBlockIcon } from '../block-icon'
import { BlockEnum } from '../types'

describe('BlockIcon', () => {
  it('renders the default workflow icon container for regular nodes', () => {
    const { container } = render(<BlockIcon type={BlockEnum.Start} size="xs" className="extra-class" />)

    const iconContainer = container.firstElementChild
    expect(iconContainer).toHaveClass('w-4', 'h-4', 'bg-util-colors-blue-brand-blue-brand-500', 'extra-class')
    expect(iconContainer?.querySelector('svg')).toBeInTheDocument()
  })

  it('normalizes protected plugin icon urls for tool-like nodes', () => {
    const { container } = render(
      <BlockIcon
        type={BlockEnum.Tool}
        toolIcon="/foo/workspaces/current/plugin/icon/plugin-tool.png"
      />,
    )

    const iconContainer = container.firstElementChild as HTMLElement
    const backgroundIcon = iconContainer.querySelector('div') as HTMLElement

    expect(iconContainer).not.toHaveClass('bg-util-colors-blue-blue-500')
    expect(backgroundIcon.style.backgroundImage).toContain(
      `${API_PREFIX}/workspaces/current/plugin/icon/plugin-tool.png`,
    )
  })
})

describe('VarBlockIcon', () => {
  it('renders the compact icon variant without the default container wrapper', () => {
    const { container } = render(
      <VarBlockIcon
        type={BlockEnum.Answer}
        className="custom-var-icon"
      />,
    )

    expect(container.querySelector('.custom-var-icon')).toBeInTheDocument()
    expect(container.querySelector('svg')).toBeInTheDocument()
    expect(container.querySelector('.bg-util-colors-warning-warning-500')).not.toBeInTheDocument()
  })
})
