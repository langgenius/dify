import type { ConsumerAppResponse } from '@dify/contracts/api/web/types.gen'
import { getWebAppRouteSegment } from '@/service/webapp-address'
import { basePath } from '@/utils/var'

export function getEndUserAppHref(app: Pick<ConsumerAppResponse, 'mode' | 'app_code'>) {
  return `${basePath}/${getWebAppRouteSegment(app.mode)}/${encodeURIComponent(app.app_code)}`
}
