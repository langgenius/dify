import { emojiCatalogOptions } from '@/app/components/base/icon-picker/emoji-data'
import { createConsoleQueryClient, createConsoleQueryWrapper } from '@/test/console/query-data'

export const defaultIcon = { type: 'emoji' as const, icon: '😀', background: '#FEF3F2' }

export function createIconPickerEnvironment() {
  const queryClient = createConsoleQueryClient()
  queryClient.setQueryData(emojiCatalogOptions.queryKey, [])
  return { queryClient, Wrapper: createConsoleQueryWrapper({ queryClient }).wrapper }
}
