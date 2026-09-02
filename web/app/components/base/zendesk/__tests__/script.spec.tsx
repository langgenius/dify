import { act, render, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vite-plus/test'
import { createZendeskRuntime } from '../runtime'
import { ZendeskScript } from '../script'

describe('ZendeskScript', () => {
  afterEach(() => {
    vi.useRealTimers()
    vi.restoreAllMocks()
    window.zE = undefined
  })

  it('does not insert the SDK script until loading is requested', async () => {
    const runtime = createZendeskRuntime(() => window.zE)
    const appendChild = vi.spyOn(document.body, 'appendChild').mockImplementation((node) => node)
    const getScripts = () =>
      appendChild.mock.calls
        .map(([node]) => node)
        .filter((node): node is HTMLScriptElement => node instanceof HTMLScriptElement)
    render(<ZendeskScript nonce="test-nonce" runtime={runtime} widgetKey="test-key" />)

    expect(getScripts()).toHaveLength(0)

    let loadPromise!: Promise<void>
    act(() => {
      loadPromise = runtime.requestLoad()
      void runtime.requestLoad()
    })

    await waitFor(() => expect(getScripts()).toHaveLength(1))
    const script = getScripts()[0]!
    expect(script.src).toBe('https://static.zdassets.com/ekr/snippet.js?key=test-key')
    expect(script.nonce).toBe('test-nonce')

    window.zE = vi.fn()
    act(() => script.dispatchEvent(new Event('load')))
    await loadPromise
  })

  it('removes a failed script and inserts a fresh one when retried', async () => {
    const runtime = createZendeskRuntime(() => window.zE)
    const appendChild = vi.spyOn(document.body, 'appendChild').mockImplementation((node) => node)
    const getScripts = () =>
      appendChild.mock.calls
        .map(([node]) => node)
        .filter((node): node is HTMLScriptElement => node instanceof HTMLScriptElement)
    render(<ZendeskScript runtime={runtime} widgetKey="test-key" />)

    let failedLoad!: Promise<void>
    act(() => {
      failedLoad = runtime.requestLoad()
    })
    await waitFor(() => expect(getScripts()).toHaveLength(1))
    const failedScript = getScripts()[0]!
    const failedExpectation = expect(failedLoad).rejects.toThrow('Failed to load Zendesk')
    act(() => failedScript.dispatchEvent(new Event('error')))
    await failedExpectation

    let retryLoad!: Promise<void>
    act(() => {
      retryLoad = runtime.requestLoad()
    })
    await waitFor(() => expect(getScripts()).toHaveLength(2))
    const retryScript = getScripts()[1]!
    expect(retryScript).not.toBe(failedScript)

    window.zE = vi.fn()
    act(() => retryScript.dispatchEvent(new Event('load')))
    await retryLoad
  })

  it('fails a stalled load so the user can retry', async () => {
    vi.useFakeTimers()
    const runtime = createZendeskRuntime(() => window.zE)
    const appendChild = vi.spyOn(document.body, 'appendChild').mockImplementation((node) => node)
    const getScripts = () =>
      appendChild.mock.calls
        .map(([node]) => node)
        .filter((node): node is HTMLScriptElement => node instanceof HTMLScriptElement)
    render(<ZendeskScript runtime={runtime} widgetKey="test-key" />)

    let stalledLoad!: Promise<void>
    act(() => {
      stalledLoad = runtime.requestLoad()
    })
    expect(getScripts()).toHaveLength(1)
    const stalledScript = getScripts()[0]!
    const remove = vi.spyOn(stalledScript, 'remove')
    const stalledExpectation = expect(stalledLoad).rejects.toThrow('Failed to load Zendesk')

    await act(() => vi.advanceTimersByTimeAsync(15_000))

    await stalledExpectation
    expect(runtime.getSnapshot()).toEqual({ attempt: 1, status: 'error' })
    expect(remove).toHaveBeenCalledOnce()
  })
})
