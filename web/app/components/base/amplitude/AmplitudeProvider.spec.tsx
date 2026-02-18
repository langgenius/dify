import { render } from '@testing-library/react'
import * as React from 'react'
// app/components/base/amplitude/AmplitudeProvider.spec.tsx
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const initMock = vi.fn()
const addMock = vi.fn()

vi.mock('@amplitude/analytics-browser', () => ({
  init: initMock,
  add: addMock,
  logEvent: vi.fn(),
  remove: vi.fn(),
  Types: {},
}))

const mockSessionReplayPlugin = vi.fn((opts: { sampleRate?: number }) => ({
  name: 'session-replay-plugin',
  opts,
}))

vi.mock('@amplitude/plugin-session-replay-browser', () => ({
  sessionReplayPlugin: mockSessionReplayPlugin,
}))

type EventLike = {
  event_type: string
  event_properties?: Record<string, unknown>
}

describe('AmplitudeProvider & helpers', () => {
  beforeEach(() => {
    vi.resetModules()
    initMock.mockClear()
    addMock.mockClear()
    mockSessionReplayPlugin.mockClear()
    window.history.replaceState({}, '', '/')
  })

  afterEach(() => {
    window.history.replaceState({}, '', '/')
  })

  it('isAmplitudeEnabled behaves correctly for config combinations', async () => {
    vi.resetModules()
    vi.doMock('@/config', () => ({
      AMPLITUDE_API_KEY: '',
      IS_CLOUD_EDITION: false,
    }))
    const mod1 = await import('./AmplitudeProvider')
    expect(mod1.isAmplitudeEnabled()).toBe(false)

    vi.resetModules()
    vi.doMock('@/config', () => ({
      AMPLITUDE_API_KEY: '',
      IS_CLOUD_EDITION: true,
    }))
    const mod2 = await import('./AmplitudeProvider')
    expect(mod2.isAmplitudeEnabled()).toBe(false)

    vi.resetModules()
    vi.doMock('@/config', () => ({
      AMPLITUDE_API_KEY: 'key',
      IS_CLOUD_EDITION: true,
    }))
    const mod3 = await import('./AmplitudeProvider')
    expect(mod3.isAmplitudeEnabled()).toBe(true)
  })

  it('does nothing when amplitude disabled', async () => {
    vi.resetModules()
    vi.doMock('@/config', () => ({
      AMPLITUDE_API_KEY: '',
      IS_CLOUD_EDITION: false,
    }))
    const { default: Provider } = await import('./AmplitudeProvider')

    render(<Provider />)

    expect(initMock).not.toHaveBeenCalled()
    expect(addMock).not.toHaveBeenCalled()
  })

  it('initializes amplitude and registers plugins when enabled', async () => {
    vi.resetModules()
    vi.doMock('@/config', () => ({
      AMPLITUDE_API_KEY: 'abc',
      IS_CLOUD_EDITION: true,
    }))
    const { default: Provider } = await import('./AmplitudeProvider')

    window.history.replaceState({}, '', '/datasets/1')

    render(<Provider sessionReplaySampleRate={0.2} />)

    expect(initMock).toHaveBeenCalledTimes(1)
    expect(initMock.mock.calls[0][0]).toBe('abc')

    expect(addMock).toHaveBeenCalledTimes(2)

    const enrichmentPlugin = addMock.mock.calls[0][0]
    expect(typeof enrichmentPlugin.execute).toBe('function')

    const pageEvent: EventLike = {
      event_type: '[Amplitude] Page Viewed',
      event_properties: {},
    }

    if (typeof enrichmentPlugin.execute === 'function') {
      const result = await enrichmentPlugin.execute(pageEvent)
      expect(result.event_properties?.['[Amplitude] Page Title']).toBe('Knowledge')
    }

    expect(mockSessionReplayPlugin).toHaveBeenCalledWith({ sampleRate: 0.2 })

    const replayPlugin = addMock.mock.calls[1][0] as {
      name: string
      opts: { sampleRate?: number }
    }

    expect(replayPlugin.name).toBe('session-replay-plugin')
    expect(replayPlugin.opts).toEqual({ sampleRate: 0.2 })
  })

  it('capitalizes unknown path segments', async () => {
    vi.resetModules()
    vi.doMock('@/config', () => ({
      AMPLITUDE_API_KEY: 'abc',
      IS_CLOUD_EDITION: true,
    }))
    const { default: Provider } = await import('./AmplitudeProvider')

    window.history.replaceState({}, '', '/custom-page')

    render(<Provider />)

    const enrichmentPlugin = addMock.mock.calls[0][0]

    const event: EventLike = {
      event_type: '[Amplitude] Page Viewed',
      event_properties: {},
    }

    if (typeof enrichmentPlugin.execute === 'function') {
      const result = await enrichmentPlugin.execute(event)
      expect(result.event_properties?.['[Amplitude] Page Title']).toBe('Custom-page')
    }
  })

  it('does not modify non page view events', async () => {
    vi.resetModules()
    vi.doMock('@/config', () => ({
      AMPLITUDE_API_KEY: 'abc',
      IS_CLOUD_EDITION: true,
    }))
    const { default: Provider } = await import('./AmplitudeProvider')

    render(<Provider />)

    const enrichmentPlugin = addMock.mock.calls[0][0]

    const event: EventLike = {
      event_type: 'Other Event',
      event_properties: { existing: true },
    }

    if (typeof enrichmentPlugin.execute === 'function') {
      const result = await enrichmentPlugin.execute(event)
      expect(result.event_properties?.existing).toBe(true)
      expect(result.event_properties?.['[Amplitude] Page Title']).toBeUndefined()
    }
  })
})
