import { useQuery } from '@tanstack/react-query'
import { useTranslation } from 'react-i18next'
import { consoleQuery } from '@/service/console'

export const FILE_SCAN_PROVIDER_TYPES = [
  'clamav',
  'cloudmersive',
  'scanii',
  'metadefender',
  'api',
] as const
export type FileScanProviderType = (typeof FILE_SCAN_PROVIDER_TYPES)[number]

export const SCANII_REGIONS = ['us1', 'eu1', 'eu2', 'ap1', 'ap2', 'ca1'] as const
export type ScaniiRegion = (typeof SCANII_REGIONS)[number]

// Product names stay untranslated in every locale.
const PROVIDER_BRAND_NAMES: Record<Exclude<FileScanProviderType, 'api'>, string> = {
  clamav: 'ClamAV',
  cloudmersive: 'Cloudmersive',
  scanii: 'Scanii',
  metadefender: 'MetaDefender Cloud',
}

// Where each cloud vendor lets a customer create an API key.
const PROVIDER_API_KEY_URLS: Partial<Record<FileScanProviderType, string>> = {
  cloudmersive: 'https://portal.cloudmersive.com/keys',
  scanii: 'https://www.scanii.com/accounts',
  metadefender: 'https://metadefender.opswat.com/account',
}

/** The vendor page for creating an API key; ClamAV and custom endpoints have none. */
export function fileScanProviderApiKeyUrl(type: FileScanProviderType) {
  return PROVIDER_API_KEY_URLS[type]
}

export function isFileScanProviderType(value: string): value is FileScanProviderType {
  return FILE_SCAN_PROVIDER_TYPES.some((type) => type === value)
}

export function isScaniiRegion(value: unknown): value is ScaniiRegion {
  return SCANII_REGIONS.some((region) => region === value)
}

/** ClamAV runs inside the deployment; every other scanner receives the file over the network. */
export function fileScanProviderSendsFileContents(type: FileScanProviderType) {
  return type !== 'clamav'
}

export function useFileScanProviderTypeLabel() {
  const { t } = useTranslation(['fileScan'])
  return (type: string) => {
    if (!isFileScanProviderType(type)) return type
    if (type === 'api') return t(($) => $['type.customEndpoint'], { ns: 'fileScan' })
    return PROVIDER_BRAND_NAMES[type]
  }
}

/** The whole feature stays hidden until the workspace reports it as enabled. */
export function useFileScanEnabled() {
  const { data } = useQuery(
    consoleQuery.features.get.queryOptions({ select: (features) => features.enable_file_scan }),
  )
  return data === true
}
