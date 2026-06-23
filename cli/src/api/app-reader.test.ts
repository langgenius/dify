import type { ActiveContext } from '@/auth/hosts'
import type { HttpClient } from '@/http/types'
import { describe, expect, it } from 'vitest'
import { selectAppReader, SubjectKind, subjectOf } from './app-reader'
import { AppsClient } from './apps'
import { PermittedExternalAppsClient } from './permitted-external-apps'

const http = { baseURL: 'https://x', request: async () => new Response() } as unknown as HttpClient

function ctx(external: boolean): ActiveContext {
  return {
    host: 'h',
    email: 'e',
    ctx: {
      account: { id: 'a', email: 'e', name: 'n' },
      external_subject: external ? { email: 'e', issuer: 'i' } : undefined,
    },
  }
}

describe('selectAppReader', () => {
  it('account login → AppsClient', () => {
    expect(selectAppReader(ctx(false), http)).toBeInstanceOf(AppsClient)
    expect(subjectOf(ctx(false))).toBe(SubjectKind.Account)
  })
  it('external_subject present → PermittedExternalAppsClient', () => {
    expect(selectAppReader(ctx(true), http)).toBeInstanceOf(PermittedExternalAppsClient)
    expect(subjectOf(ctx(true))).toBe(SubjectKind.External)
  })
})
