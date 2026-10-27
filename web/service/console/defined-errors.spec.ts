import { ORPCError } from '@orpc/client'
import { oc } from '@orpc/contract'
import { describe, expect, it } from 'vite-plus/test'
import { validateDefinedErrors } from './defined-errors'

const contract = {
  drafts: {
    sync: oc.route({ method: 'POST', path: '/drafts' }).errors({
      draft_workflow_not_sync: { status: 409 },
    }),
  },
}

const failWith = (error: unknown, path: readonly string[] = ['drafts', 'sync']) =>
  validateDefinedErrors(contract)({
    context: {},
    input: undefined,
    path,
    next: () => Promise.reject(error),
  }).catch((rejected: unknown) => rejected)

describe('console link error validation', () => {
  it('marks errors the procedure documents as defined', async () => {
    const error = await failWith(new ORPCError('draft_workflow_not_sync', { status: 409 }))

    expect(error).toBeInstanceOf(ORPCError)
    expect(error).toMatchObject({ code: 'draft_workflow_not_sync', defined: true })
  })

  it('leaves undocumented codes and statuses undefined', async () => {
    const undocumented = await failWith(new ORPCError('surprise', { status: 409 }))
    const wrongStatus = await failWith(new ORPCError('draft_workflow_not_sync', { status: 400 }))

    expect(undocumented).toMatchObject({ code: 'surprise', defined: false })
    expect(wrongStatus).toMatchObject({ code: 'draft_workflow_not_sync', defined: false })
  })

  it('passes through errors outside a contract procedure', async () => {
    const network = new TypeError('Failed to fetch')

    expect(await failWith(network)).toBe(network)
    expect(
      await failWith(new ORPCError('draft_workflow_not_sync', { status: 409 }), ['drafts']),
    ).toMatchObject({
      defined: false,
    })
  })
})
