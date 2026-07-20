import type { AppRedirectionTarget } from '@/utils/app-redirection'
import { consoleClient } from '@/service/client'
import { AppModeEnum } from '@/types/app'

export const resolveImportedAppRedirectionTarget = async (
  app: AppRedirectionTarget,
): Promise<AppRedirectionTarget> => {
  if (app.mode !== AppModeEnum.AGENT) return app

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
