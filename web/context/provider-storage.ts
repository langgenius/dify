import { createLocalStorageState } from 'foxact/create-local-storage-state'

const ANTHROPIC_QUOTA_NOTICE_STORAGE_KEY = 'anthropic_quota_notice'

const [useAnthropicQuotaNotice, _useAnthropicQuotaNoticeValue, _useSetAnthropicQuotaNotice] =
  createLocalStorageState<string>(ANTHROPIC_QUOTA_NOTICE_STORAGE_KEY, 'false', { raw: true })

export { useAnthropicQuotaNotice }
