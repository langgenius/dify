export const AUTO_UPDATE_STRATEGY = {
  fixOnly: 'fix_only',
  disabled: 'disabled',
  latest: 'latest',
} as const

export type AUTO_UPDATE_STRATEGY = (typeof AUTO_UPDATE_STRATEGY)[keyof typeof AUTO_UPDATE_STRATEGY]

export const AUTO_UPDATE_MODE = {
  partial: 'partial',
  exclude: 'exclude',
  update_all: 'all',
} as const

export type AUTO_UPDATE_MODE = (typeof AUTO_UPDATE_MODE)[keyof typeof AUTO_UPDATE_MODE]

export type AutoUpdateConfig = {
  strategy_setting: AUTO_UPDATE_STRATEGY
  upgrade_time_of_day: number
  upgrade_mode: AUTO_UPDATE_MODE
  exclude_plugins: string[]
  include_plugins: string[]
}
