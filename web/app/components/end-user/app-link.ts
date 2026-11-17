import type { ConsumerAppResponse } from '@dify/contracts/api/web/types.gen'
import { basePath } from '@/utils/var'

export function getEndUserAppHref(app: Pick<ConsumerAppResponse, 'mode' | 'app_code'>) {
  const route = app.mode === 'workflow' ? 'workflow' : 'chat'
  return `${basePath}/${route}/${encodeURIComponent(app.app_code)}`
}
