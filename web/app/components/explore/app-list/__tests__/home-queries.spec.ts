import type { GetExploreAppsResponse } from '@dify/contracts/api/console/explore/types.gen'
import { describe, expect, it } from 'vitest'
import {
  getHomeTemplatesInput,
  homeContinueWorkAppsInput,
  normalizeHomeTemplates,
  selectHomeContinueWorkApps,
} from '../home-queries'

describe('home query contracts', () => {
  it('should use canonical Home inputs and normalize templates before caching', () => {
    const response = {
      categories: ['Writing', 'Assistant'],
      recommended_apps: [
        {
          app_id: 'second',
          can_trial: false,
          categories: ['Assistant'],
          position: 2,
          app: { id: 'second-app', icon_url: null },
        },
        {
          app_id: 'first',
          can_trial: true,
          categories: ['Writing'],
          position: 1,
          app: { id: 'first-app', icon_url: null },
        },
      ],
    } satisfies GetExploreAppsResponse

    expect(getHomeTemplatesInput('en-US')).toEqual({ query: { language: 'en-US' } })
    expect(getHomeTemplatesInput()).toEqual({})
    expect(homeContinueWorkAppsInput).toEqual({ query: { limit: 8 } })
    expect(normalizeHomeTemplates(response)).toMatchObject({
      categories: ['Writing', 'Assistant'],
      allList: [{ app_id: 'first' }, { app_id: 'second' }],
    })
  })

  it('should cache the selected recent app list shape', () => {
    const apps = [{ id: 'app-1' }]

    expect(selectHomeContinueWorkApps({ data: apps as never[] })).toBe(apps)
  })
})
