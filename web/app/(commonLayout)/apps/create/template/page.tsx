import { CreateAppTemplateRoute } from '@/app/components/apps/create-app-route'
import { getRouteMetadata } from '@/app/route-metadata'

export function generateMetadata() {
  return getRouteMetadata('navigation', ($) => $['menus.apps'])
}

// Visited directly, `/apps/create/template` shows only the template dialog.
export default function CreateAppTemplatePage() {
  return <CreateAppTemplateRoute />
}
