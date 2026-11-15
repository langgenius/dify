import { afterEach, beforeEach, describe, expect, it, vi } from 'vite-plus/test'
import createFoldAnimInto from '../create-fold-anim-into'

const mountModal = () => {
  const modal = document.createElement('div')
  modal.className = 'install-modal'
  vi.spyOn(modal, 'getBoundingClientRect').mockReturnValue(new DOMRect(100, 100, 400, 300))
  document.body.appendChild(modal)
  return modal
}

beforeEach(() => vi.useFakeTimers())
afterEach(() => {
  vi.useRealTimers()
  vi.restoreAllMocks()
  document
    .querySelectorAll('.install-modal, #plugin-task-trigger, .plugins-nav-button')
    .forEach((element) => element.remove())
})

describe('createFoldAnimInto', () => {
  it.each([false, true])(
    'closes immediately without an animation target (modal present: %s)',
    async (hasModal) => {
      if (hasModal) mountModal()
      const onClose = vi.fn()
      await createFoldAnimInto(onClose).foldIntoAnim()
      expect(onClose).toHaveBeenCalledOnce()
    },
  )

  it.each(['task', 'navigation'])('closes after folding to the %s target', async (target) => {
    mountModal()
    const trigger = document.createElement('button')
    if (target === 'task') trigger.id = 'plugin-task-trigger'
    else trigger.className = 'plugins-nav-button'
    vi.spyOn(trigger, 'getBoundingClientRect').mockReturnValue(new DOMRect(50, 50, 40, 40))
    document.body.appendChild(trigger)
    const onClose = vi.fn()
    const pending = createFoldAnimInto(onClose).foldIntoAnim()

    await vi.advanceTimersByTimeAsync(749)
    expect(onClose).not.toHaveBeenCalled()
    await vi.advanceTimersByTimeAsync(1)
    await pending
    expect(onClose).toHaveBeenCalledOnce()
  })
})
