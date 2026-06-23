import type { AppDescribeResponse, AppListResponse } from '@dify/contracts/api/openapi/types.gen'
import type { ListQuery } from './apps'
import type { ActiveContext } from '@/auth/hosts'
import type { HttpClient } from '@/http/types'
import { AppsClient } from './apps'
import { PermittedExternalAppsClient } from './permitted-external-apps'

export type AppReader = {
  list: (q: ListQuery) => Promise<AppListResponse>
  describe: (appId: string, fields?: readonly string[]) => Promise<AppDescribeResponse>
}

// The auth subject behind an openapi bearer token. Each kind reads apps from its own surface.
export const SubjectKind = {
  Account: 'account',
  External: 'external',
} as const

export type SubjectKindValue = (typeof SubjectKind)[keyof typeof SubjectKind]

export function subjectOf(active: ActiveContext): SubjectKindValue {
  return active.ctx.external_subject !== undefined ? SubjectKind.External : SubjectKind.Account
}

type AppReaderFactory = (http: HttpClient) => AppReader

// Maps each auth subject to the app reader for its surface.
const APP_READER_BY_SUBJECT: Readonly<Record<SubjectKindValue, AppReaderFactory>> = {
  [SubjectKind.Account]: http => new AppsClient(http),
  [SubjectKind.External]: http => new PermittedExternalAppsClient(http),
}

export function selectAppReader(active: ActiveContext, http: HttpClient): AppReader {
  return APP_READER_BY_SUBJECT[subjectOf(active)](http)
}
