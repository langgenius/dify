export const CreateButtonType = {
  FULL_BUTTON: 'full-button',
  ICON_BUTTON: 'icon-button',
} as const
export type CreateButtonType = typeof CreateButtonType[keyof typeof CreateButtonType]

export const DEFAULT_METHOD = 'default'
