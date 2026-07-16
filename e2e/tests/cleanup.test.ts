import { describe, expect, it, vi } from 'vitest'
import { runCleanupTasks } from '../support/cleanup'

describe('runCleanupTasks', () => {
  it('runs every task in order', async () => {
    const order: string[] = []

    const errors = await runCleanupTasks([
      {
        label: 'first',
        run: () => {
          order.push('first')
        },
      },
      {
        label: 'second',
        run: async () => {
          order.push('second')
        },
      },
    ])

    expect(order).toEqual(['first', 'second'])
    expect(errors).toEqual([])
  })

  it('continues after failures and labels every error', async () => {
    const finalTask = vi.fn()

    const errors = await runCleanupTasks([
      {
        label: 'sync cleanup',
        run: () => {
          throw new Error('sync failure')
        },
      },
      {
        label: 'async cleanup',
        run: async () => {
          throw new Error('async failure')
        },
      },
      { label: 'final cleanup', run: finalTask },
    ])

    expect(finalTask).toHaveBeenCalledOnce()
    expect(errors).toEqual(['sync cleanup: sync failure', 'async cleanup: async failure'])
  })
})
