import { cn } from '@langgenius/dify-ui/cn'

export const DEPLOYMENT_DETAIL_TABLE_COLUMN_CLASS_NAMES = {
  actions: 'w-14',
  currentRelease: 'w-[34%]',
  environment: 'w-[34%]',
  status: 'w-[24%]',
}

export const RELEASE_DETAIL_TABLE_COLUMN_CLASS_NAMES = {
  action: 'w-14',
  author: 'w-[15%]',
  createdAt: 'w-[16%]',
  deployedTo: 'w-[22%]',
  release: 'w-[24%]',
  sourceApp: 'w-[18%]',
}

export const ACCESS_PERMISSION_DETAIL_TABLE_COLUMN_CLASS_NAMES = {
  environment: 'w-[22%]',
  permission: 'w-[28%]',
  subjects: 'w-[50%]',
}

export const API_KEY_DETAIL_TABLE_COLUMN_CLASS_NAMES = {
  action: 'w-16',
  environment: 'w-[20%]',
  key: 'w-[38%]',
  name: 'w-[28%]',
}

export const DETAIL_TABLE_ACTION_TRIGGER_CLASS_NAME = cn(
  'inline-flex size-8 items-center justify-center rounded-md text-text-tertiary outline-hidden',
  'hover:bg-state-base-hover hover:text-text-secondary focus-visible:ring-2 focus-visible:ring-state-accent-solid',
  'data-popup-open:bg-state-base-hover data-popup-open:text-text-secondary',
  'disabled:cursor-not-allowed disabled:opacity-50',
)
