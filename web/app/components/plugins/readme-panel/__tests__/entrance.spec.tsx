import { fireEvent, render, screen } from '@testing-library/react'
import { beforeEach, describe, expect, it } from 'vitest'
import { ReadmeEntrance } from '../entrance'
import { useReadmePanelStore } from '../store'

describe('ReadmeEntrance', () => {
  beforeEach(() => {
    useReadmePanelStore.setState({ currentPanel: undefined })
  })

  it('should render readme button for non-builtin plugin with unique identifier', () => {
    const pluginDetail = { id: 'custom-plugin', name: 'custom-plugin', plugin_unique_identifier: 'org/custom-plugin' } as never
    render(<ReadmeEntrance pluginDetail={pluginDetail} />)

    expect(screen.getByRole('button')).toBeInTheDocument()
  })

  it('should open drawer presentation by default', () => {
    const pluginDetail = { id: 'custom-plugin', name: 'custom-plugin', plugin_unique_identifier: 'org/custom-plugin' } as never
    render(<ReadmeEntrance pluginDetail={pluginDetail} />)

    const button = screen.getByRole('button')
    fireEvent.click(button)

    expect(useReadmePanelStore.getState().currentPanel).toEqual({
      detail: pluginDetail,
      presentation: 'drawer',
      triggerId: button.id,
    })
  })

  it('should open dialog presentation when requested', () => {
    const pluginDetail = { id: 'custom-plugin', name: 'custom-plugin', plugin_unique_identifier: 'org/custom-plugin' } as never
    render(<ReadmeEntrance pluginDetail={pluginDetail} presentation="dialog" />)

    fireEvent.click(screen.getByRole('button'))

    expect(useReadmePanelStore.getState().currentPanel?.presentation).toBe('dialog')
  })

  it('should return null for builtin tools', () => {
    const pluginDetail = { id: 'code', name: 'Code', plugin_unique_identifier: 'org/code' } as never
    const { container } = render(<ReadmeEntrance pluginDetail={pluginDetail} />)

    expect(container.innerHTML).toBe('')
  })

  it('should return null when plugin_unique_identifier is missing', () => {
    const pluginDetail = { id: 'some-plugin', name: 'Some Plugin' } as never
    const { container } = render(<ReadmeEntrance pluginDetail={pluginDetail} />)

    expect(container.innerHTML).toBe('')
  })

  it('should return null when pluginDetail is null', () => {
    const { container } = render(<ReadmeEntrance pluginDetail={null as never} />)

    expect(container.innerHTML).toBe('')
  })
})
