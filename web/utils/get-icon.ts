import { MARKETPLACE_API_PREFIX } from '@/config'

export const getIconFromMarketPlace = (plugin_id: string) => {
  return `${MARKETPLACE_API_PREFIX}/plugins/${plugin_id}/icon`
}
