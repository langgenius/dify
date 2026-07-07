import type { PluginDetail } from '@/app/components/plugins/types'
import { beforeEach, describe, expect, it } from 'vitest'
import { useReadmePanelStore } from '../store'

describe('readme-panel/store', () => {
  beforeEach(() => {
    useReadmePanelStore.setState({ currentPanel: undefined })
  })

  it('initializes without an active panel', () => {
    const state = useReadmePanelStore.getState()
    expect(state.currentPanel).toBeUndefined()
  })

  it('opens drawer presentation by default', () => {
    const detail = { id: 'test', plugin_unique_identifier: 'uid' } as PluginDetail
    useReadmePanelStore.getState().openReadmePanel({ detail, triggerId: 'readme-trigger' })

    expect(useReadmePanelStore.getState().currentPanel).toEqual({
      detail,
      presentation: 'drawer',
      triggerId: 'readme-trigger',
    })
  })

  it('opens dialog presentation when requested', () => {
    const detail = { id: 'test', plugin_unique_identifier: 'uid' } as PluginDetail
    useReadmePanelStore.getState().openReadmePanel({ detail, presentation: 'dialog' })

    expect(useReadmePanelStore.getState().currentPanel?.presentation).toBe('dialog')
  })

  it('closes the active panel', () => {
    const detail = { id: 'test', plugin_unique_identifier: 'uid' } as PluginDetail
    useReadmePanelStore.getState().openReadmePanel({ detail })
    expect(useReadmePanelStore.getState().currentPanel).toBeDefined()

    useReadmePanelStore.getState().closeReadmePanel()
    expect(useReadmePanelStore.getState().currentPanel).toBeUndefined()
  })

  it('replaces the active panel with the latest request', () => {
    const detail1 = { id: 'plugin-1', plugin_unique_identifier: 'uid-1' } as PluginDetail
    const detail2 = { id: 'plugin-2', plugin_unique_identifier: 'uid-2' } as PluginDetail

    useReadmePanelStore.getState().openReadmePanel({ detail: detail1 })
    useReadmePanelStore.getState().openReadmePanel({ detail: detail2, presentation: 'dialog' })

    expect(useReadmePanelStore.getState().currentPanel?.detail.id).toBe('plugin-2')
    expect(useReadmePanelStore.getState().currentPanel?.presentation).toBe('dialog')
  })
})
