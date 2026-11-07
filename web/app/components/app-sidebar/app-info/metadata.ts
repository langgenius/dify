import type { AppDetailWithSite } from '@dify/contracts/api/console/apps/types.gen'

type AppMetadata = Pick<
  AppDetailWithSite,
  | 'description'
  | 'icon'
  | 'icon_background'
  | 'icon_type'
  | 'icon_url'
  | 'max_active_requests'
  | 'name'
  | 'updated_at'
  | 'use_icon_as_answer_icon'
>

export function updateCachedAppMetadata(cached: AppDetailWithSite | undefined, app: AppMetadata) {
  if (!cached) return cached
  return {
    ...cached,
    description: app.description,
    icon: app.icon,
    icon_background: app.icon_background,
    icon_type: app.icon_type,
    icon_url: app.icon_url,
    name: app.name,
    updated_at: app.updated_at,
    use_icon_as_answer_icon: app.use_icon_as_answer_icon,
    max_active_requests:
      app.max_active_requests === undefined ? cached.max_active_requests : app.max_active_requests,
  }
}
