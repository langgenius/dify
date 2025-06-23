import type { AutoUpdateConfig } from './types'
import { AUTO_UPDATE_MODE, AUTO_UPDATE_STRATEGY } from './types'
export const defaultValue: AutoUpdateConfig = {
  strategy_setting: AUTO_UPDATE_STRATEGY.fixOnly, // For test
  upgrade_time_of_day: 0,
  upgrade_mode: AUTO_UPDATE_MODE.exclude, // For test
  exclude_plugins: ['a', 'c'],
  include_plugins: ['b'],
}
