import type { AutoUpdateConfig } from './types'
import { AUTO_UPDATE_MODE, AUTO_UPDATE_STRATEGY } from './types'

export const defaultValue: AutoUpdateConfig = {
  strategy_setting: AUTO_UPDATE_STRATEGY.disabled,
  upgrade_time_of_day: 0,
  upgrade_mode: AUTO_UPDATE_MODE.update_all,
  exclude_plugins: [],
  include_plugins: [],
}
