import type { PluginDetail } from '@/app/components/plugins/types'
import { beforeEach, describe, expect, it } from 'vitest'
import { ReadmeShowType, useReadmePanelStore } from '../store'

describe('readme-panel/store', () => {
  beforeEach(() => {
    useReadmePanelStore.setState({ currentPluginDetail: undefined })
  })

  it('initializes with undefined currentPluginDetail', () => {
    const state = useReadmePanelStore.getState()
    expect(state.currentPluginDetail).toBeUndefined()
  })

  it('sets current plugin detail with drawer showType by default', () => {
    const mockDetail = { id: 'test', plugin_unique_identifier: 'uid' } as PluginDetail
    useReadmePanelStore.getState().setCurrentPluginDetail(mockDetail)

    const state = useReadmePanelStore.getState()
    expect(state.currentPluginDetail).toEqual({
      detail: mockDetail,
      showType: ReadmeShowType.drawer,
    })
  })

  it('sets current plugin detail with modal showType', () => {
    const mockDetail = { id: 'test', plugin_unique_identifier: 'uid' } as PluginDetail
    useReadmePanelStore.getState().setCurrentPluginDetail(mockDetail, ReadmeShowType.modal)

    const state = useReadmePanelStore.getState()
    expect(state.currentPluginDetail?.showType).toBe(ReadmeShowType.modal)
  })

  it('clears current plugin detail when called with undefined', () => {
    const mockDetail = { id: 'test', plugin_unique_identifier: 'uid' } as PluginDetail
    useReadmePanelStore.getState().setCurrentPluginDetail(mockDetail)
    expect(useReadmePanelStore.getState().currentPluginDetail).toBeDefined()

    useReadmePanelStore.getState().setCurrentPluginDetail(undefined)
    expect(useReadmePanelStore.getState().currentPluginDetail).toBeUndefined()
  })

  it('replaces previous detail with new one', () => {
    const detail1 = { id: 'plugin-1', plugin_unique_identifier: 'uid-1' } as PluginDetail
    const detail2 = { id: 'plugin-2', plugin_unique_identifier: 'uid-2' } as PluginDetail

    useReadmePanelStore.getState().setCurrentPluginDetail(detail1)
    expect(useReadmePanelStore.getState().currentPluginDetail?.detail.id).toBe('plugin-1')

    useReadmePanelStore.getState().setCurrentPluginDetail(detail2, ReadmeShowType.modal)
    expect(useReadmePanelStore.getState().currentPluginDetail?.detail.id).toBe('plugin-2')
    expect(useReadmePanelStore.getState().currentPluginDetail?.showType).toBe(ReadmeShowType.modal)
  })
})
