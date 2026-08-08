import type { AppPartial, GetAppsData } from '@dify/contracts/api/console/apps/types.gen'

export type GuideMethod = 'bindApp' | 'importDsl'
export type GuideStep = 'source' | 'release' | 'target'
export type WorkflowSourceApp = AppPartial & {
  mode: Extract<NonNullable<NonNullable<GetAppsData['query']>['mode']>, 'workflow'>
}
