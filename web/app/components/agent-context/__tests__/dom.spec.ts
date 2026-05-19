import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { collectInteractiveElements, getDomSnapshot, performBrowserAction } from '../dom'

describe('agent context DOM tools', () => {
  let rectSpy: ReturnType<typeof vi.spyOn>

  beforeEach(() => {
    rectSpy = vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockReturnValue({
      bottom: 20,
      height: 20,
      left: 0,
      right: 100,
      toJSON: () => ({}),
      top: 0,
      width: 100,
      x: 0,
      y: 0,
    } as DOMRect)
  })

  afterEach(() => {
    document.body.innerHTML = ''
    rectSpy.mockRestore()
  })

  it('should collect visible interactive elements with action ids', () => {
    document.body.innerHTML = `
      <button aria-label="Create app">Create</button>
      <input aria-label="App name" value="Demo" />
    `

    const actions = collectInteractiveElements()

    expect(actions).toHaveLength(2)
    expect(actions[0]).toMatchObject({
      actions: ['click', 'focus'],
      name: 'Create app',
      role: 'button',
    })
    expect(actions[0]!.action_id).toMatch(/^dify-action-/)
    expect(actions[0]!.stable_id).toBe(actions[0]!.action_id)
    expect(actions[1]).toMatchObject({
      name: 'App name',
      role: 'textbox',
      value: 'Demo',
    })
  })

  it('should perform click actions from collected action ids', () => {
    const handleClick = vi.fn()
    const button = document.createElement('button')
    button.textContent = 'Run'
    button.addEventListener('click', handleClick)
    document.body.append(button)

    const [action] = collectInteractiveElements()
    const result = performBrowserAction({ action: 'click', action_id: action!.action_id })

    expect(result).toMatchObject({ ok: true, action: 'click' })
    expect(handleClick).toHaveBeenCalledTimes(1)
  })

  it('should fill text inputs and dispatch form events', () => {
    const handleInput = vi.fn()
    const input = document.createElement('input')
    input.setAttribute('aria-label', 'Node title')
    input.addEventListener('input', handleInput)
    document.body.append(input)

    const [action] = collectInteractiveElements()
    performBrowserAction({ action: 'fill', action_id: action!.action_id, value: 'LLM node' })

    expect(input.value).toBe('LLM node')
    expect(handleInput).toHaveBeenCalledTimes(1)
  })

  it('should collect Dify cursor-pointer elements as executable actions', () => {
    document.body.innerHTML = `
      <div class="flex cursor-pointer items-center">
        <span>LLM</span>
        <span>Invoke language models</span>
      </div>
    `

    const actions = collectInteractiveElements()

    expect(actions).toHaveLength(1)
    expect(actions[0]).toMatchObject({
      actions: ['click', 'focus'],
      name: 'LLM Invoke language models',
      role: 'button',
      tag: 'div',
    })
  })

  it('should keep action ids stable across equivalent DOM refreshes', () => {
    document.body.innerHTML = '<button>Run</button>'
    const [firstAction] = collectInteractiveElements()

    document.body.innerHTML = '<button>Run</button>'
    const refreshedButton = document.querySelector('button')!
    const handleClick = vi.fn()
    refreshedButton.addEventListener('click', handleClick)

    const result = performBrowserAction({ action: 'click', action_id: firstAction!.action_id })

    expect(result).toMatchObject({ ok: true, action: 'click' })
    expect(handleClick).toHaveBeenCalledTimes(1)
  })

  it('should include visible dialog text in snapshots', () => {
    document.body.innerHTML = `
      <div role="dialog" aria-label="Create workflow node">
        <h2>Choose block</h2>
      </div>
    `

    const snapshot = getDomSnapshot()

    expect(snapshot.dialogs).toHaveLength(1)
    expect(snapshot.dialogs[0]).toMatchObject({
      name: 'Create workflow node',
      text: 'Choose block',
    })
  })
})
