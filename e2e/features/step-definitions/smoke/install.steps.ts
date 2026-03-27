import { Given } from '@cucumber/cucumber'
import { expect } from '@playwright/test'
import { getCachedSession } from '../../support/session'
import type { DifyWorld } from '../../support/world'

Given(
  'the last authentication bootstrap came from a fresh install',
  async function (this: DifyWorld) {
    const session = await getCachedSession(this)

    expect(session.mode).toBe('install')
  },
)
