import { render } from '@testing-library/react'
import { API_PREFIX } from '@/config'
import BlockIcon from '../block-icon'
import { BlockEnum } from '../types'

describe('BlockIcon', () => {
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
