import { describe, expect, it } from 'vite-plus/test'
import { runStartupTasks } from '../support/startup'

describe('E2E startup scheduling', () => {
  it('preserves sequential startup by default', async () => {
    const events: string[] = []
    await runStartupTasks(
      [
        async () => {
          events.push('api')
        },
        async () => {
          events.push('web')
        },
      ],
      false,
    )
    expect(events).toEqual(['api', 'web'])
  })

  it('waits for an in-flight sibling before exposing a startup failure to cleanup', async () => {
    let finish: () => void = () => {}
    let siblingFinished = false
    const sibling = new Promise<void>((resolve) => {
      finish = resolve
    })
    const startup = runStartupTasks(
      [
        async () => {
          throw new Error('API failed')
        },
        async () => {
          await sibling
          siblingFinished = true
        },
      ],
      true,
    )
    const rejection = expect(startup).rejects.toThrow('E2E startup failed')
    expect(siblingFinished).toBe(false)
    finish()
    await rejection
    expect(siblingFinished).toBe(true)
  })
})
