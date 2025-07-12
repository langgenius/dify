export enum AUTO_UPDATE_STRATEGY {
  fixOnly = 'fix_only',
  disabled = 'disabled',
  latest = 'latest',
}

export enum AUTO_UPDATE_MODE {
  partial = 'partial',
  exclude = 'exclude',
  update_all = 'all',
}

export type AutoUpdateConfig = {
  strategy_setting: AUTO_UPDATE_STRATEGY
  upgrade_time_of_day: number
  upgrade_mode: AUTO_UPDATE_MODE
  exclude_plugins: string[]
  include_plugins: string[]
}
