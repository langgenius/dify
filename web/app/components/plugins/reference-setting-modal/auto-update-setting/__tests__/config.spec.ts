import { describe, expect, it } from 'vitest'
import { defaultValue } from '../config'
import { AUTO_UPDATE_MODE, AUTO_UPDATE_STRATEGY } from '../types'

describe('auto-update config', () => {
  it('provides the expected default auto update value', () => {
    expect(defaultValue).toEqual({
      strategy_setting: AUTO_UPDATE_STRATEGY.disabled,
      upgrade_time_of_day: 0,
      upgrade_mode: AUTO_UPDATE_MODE.update_all,
      exclude_plugins: [],
      include_plugins: [],
    })
  })
})
