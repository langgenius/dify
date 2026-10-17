import { ORPCError } from '@orpc/client'
import { oc } from '@orpc/contract'
import { openapi } from '@orpc/openapi'
import { describe, expect, it } from 'vite-plus/test'
import * as z from 'zod'
import { HttpError } from '@/service/http-error'
import { validateDefinedErrors } from './defined-errors'

// Generated error maps pin each documented code to its HTTP status through the body schema.
const contract = {
  drafts: {
    sync: oc.meta(openapi({ method: 'POST', path: '/drafts' })).errors({
      draft_workflow_not_sync: { data: z.object({ status: z.literal(409) }) },
    }),
  },
}

const failWith = (error: unknown, path: string[] = ['drafts', 'sync']) =>
  validateDefinedErrors(contract)({
    context: {},
    input: undefined,
    path,
    next: () => Promise.reject(error),
  }).catch((rejected: unknown) => rejected)

const httpError = (code: string, status: number) =>
  new HttpError(code, { status, data: { code, status } })

describe('console link error validation', () => {
  it('marks errors the procedure documents as defined and keeps their HTTP status', async () => {
    const error = await failWith(httpError('draft_workflow_not_sync', 409))

    expect(error).toBeInstanceOf(ORPCError)
    expect(error).toMatchObject({ code: 'draft_workflow_not_sync', defined: true, status: 409 })
  })

  it('leaves undocumented codes and statuses undefined', async () => {
    const undocumented = await failWith(httpError('surprise', 409))
    const wrongStatus = await failWith(httpError('draft_workflow_not_sync', 400))

    expect(undocumented).toMatchObject({ code: 'surprise', defined: false })
    expect(wrongStatus).toMatchObject({ code: 'draft_workflow_not_sync', defined: false })
  })

  it('passes through errors outside a contract procedure', async () => {
    const network = new TypeError('Failed to fetch')

    expect(await failWith(network)).toBe(network)
    expect(await failWith(httpError('draft_workflow_not_sync', 409), ['drafts'])).toMatchObject({
      defined: false,
    })
  })
})
