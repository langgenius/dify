import type { Node } from '../types'
import { useQuery } from '@tanstack/react-query'
import { useTranslation } from 'react-i18next'
import { CollectionType } from '@/app/components/tools/types'
import { selectToolsWithProvider } from '@/app/components/tools/utils/query-select'
import { consoleQuery } from '@/service/console'
import { matchesProviderReference } from '@/utils/provider-reference'
import { isToolAuthorizationRequired } from '../nodes/tool/auth'
import { useToolAuthorization } from '../nodes/tool/hooks/use-tool-authorization'
import { useStore } from '../store'
import { BlockEnum } from '../types'

export const useSingleRunAuthorization = (id: string, data: Node['data']) => {
  const { t } = useTranslation(['workflow'])
  const isBuiltInTool =
    data.type === BlockEnum.Tool && data.provider_type === CollectionType.builtIn
  const { data: builtInTools } = useQuery(
    consoleQuery.workspaces.current.tools.builtin.get.queryOptions({
      enabled: isBuiltInTool,
      select: selectToolsWithProvider,
    }),
  )
  const storedTools = useStore((state) => (isBuiltInTool ? state.buildInTools : undefined))
  const collection = (builtInTools ?? storedTools)?.find((tool) =>
    matchesProviderReference(tool, data.provider_id),
  )
  const authorization = useToolAuthorization(id, data, isBuiltInTool && !!collection?.allow_delete)
  const appUserDraft =
    authorization?.status === 'resolved' && authorization.authorizationTab === 'app-user-auth'
      ? authorization.appUserDraft
      : undefined
  const usesAppUserAuth = !!appUserDraft
  let disabledReason: string | undefined

  if (usesAppUserAuth) {
    if (!appUserDraft.draft.testCredentialId)
      disabledReason = t(($) => $['panel.configureTestRunConnection'], { ns: 'workflow' })
  } else if (authorization?.status === 'invalid') {
    disabledReason = t(($) => $['panel.selectReuseNode'], { ns: 'workflow' })
  } else if (isBuiltInTool && isToolAuthorizationRequired(CollectionType.builtIn, collection)) {
    disabledReason = t(($) => $['panel.configureWorkspaceAuthorization'], { ns: 'workflow' })
  }

  return { disabledReason, usesAppUserAuth, authorization }
}
