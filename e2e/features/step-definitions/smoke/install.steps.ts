import type { DifyWorld } from '../../support/world'
import { Given } from '@cucumber/cucumber'
import { expect } from '@playwright/test'

Given(
  'the last authentication bootstrap came from a fresh install',
  async function (this: DifyWorld) {
    const session = await this.getAuthSession()

    expect(session.mode).toBe('install')
  },
)
