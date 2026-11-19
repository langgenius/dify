import type { AppRedirectionTarget } from '@/utils/app-redirection'
import { consoleClient } from '@/service/console'

export const resolveImportedAppRedirectionTarget = async (
  app: AppRedirectionTarget,
): Promise<AppRedirectionTarget> => {
  if (app.mode !== 'agent') return app

  try {
    const importedApp = await consoleClient.apps.byAppId.get({
      params: { app_id: app.id },
    })

    return {
      ...app,
      bound_agent_id: importedApp.bound_agent_id,
    }
  } catch {
    return app
  }
}
