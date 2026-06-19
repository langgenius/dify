import { cn } from '@langgenius/dify-ui/cn'

export const DEPLOYMENT_DETAIL_TABLE_COLUMN_CLASS_NAMES = {
  actions: 'w-14 py-1.5 whitespace-nowrap',
  currentRelease: '',
  environment: 'whitespace-nowrap',
  status: 'whitespace-nowrap',
}

export const RELEASE_DETAIL_TABLE_COLUMN_CLASS_NAMES = {
  action: 'w-14 py-1.5 whitespace-nowrap',
  author: 'whitespace-nowrap',
  createdAt: 'whitespace-nowrap',
  deployedTo: '',
  release: 'whitespace-nowrap',
  sourceApp: 'whitespace-nowrap',
}

export const API_KEY_DETAIL_TABLE_COLUMN_CLASS_NAMES = {
  action: 'w-16 py-1.5 whitespace-nowrap',
  environment: 'whitespace-nowrap',
  key: '',
  name: 'whitespace-nowrap',
}

export const DETAIL_TABLE_ACTION_TRIGGER_CLASS_NAME = cn(
  'inline-flex size-8 items-center justify-center rounded-md text-text-tertiary outline-hidden',
  'hover:bg-state-base-hover hover:text-text-secondary focus-visible:ring-2 focus-visible:ring-state-accent-solid',
  'data-popup-open:bg-state-base-hover data-popup-open:text-text-secondary',
  'disabled:cursor-not-allowed disabled:opacity-50',
)
