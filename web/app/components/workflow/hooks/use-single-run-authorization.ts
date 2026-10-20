import type { CommonNodeType, Node } from '../types'
import { useQuery } from '@tanstack/react-query'
import { useTranslation } from 'react-i18next'
import { useNodes } from 'reactflow'
import { getEnabledTestConnectionState } from '@/app/components/plugins/plugin-auth/app-user-auth/test-connection/model'
import { CollectionType } from '@/app/components/tools/types'
import { selectToolsWithProvider } from '@/app/components/tools/utils/query-select'
import { consoleQuery } from '@/service/console'
import { matchesProviderReference } from '@/utils/provider-reference'
import { isToolAuthorizationRequired } from '../nodes/tool/auth'
import { resolveToolAuthorization } from '../nodes/tool/authorization'
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
  const storedTools = useStore((state) => state.buildInTools)
  const nodes = useNodes<CommonNodeType>()
  const nodeAuthDrafts = useStore((state) => state.nodeAuthDrafts)
  const collection = (builtInTools ?? storedTools)?.find((tool) =>
    matchesProviderReference(tool, data.provider_id),
  )
  const authorization =
    isBuiltInTool && collection?.allow_delete
      ? resolveToolAuthorization({
          node: { id, data },
          nodes,
          nodeAuthDrafts,
          provider: collection.name,
        })
      : undefined
  const appUserDraft =
    authorization?.status === 'resolved' && authorization.authorizationTab === 'app-user-auth'
      ? authorization.appUserDraft
      : undefined
  const usesAppUserAuth = !!appUserDraft
  let disabledReason: string | undefined

  if (usesAppUserAuth) {
    const draft = appUserDraft.draft
    const { selectedConnection } = getEnabledTestConnectionState(draft?.testConnection, {
      oauthEnabled: draft?.oauthEnabled ?? true,
      apiKeyEnabled: draft?.apiKeyEnabled ?? true,
    })
    if (!selectedConnection)
      disabledReason = t(($) => $['panel.configureTestRunConnection'], { ns: 'workflow' })
  } else if (authorization?.status === 'invalid') {
    disabledReason = t(($) => $['panel.selectReuseNode'], { ns: 'workflow' })
  } else if (isBuiltInTool && isToolAuthorizationRequired(CollectionType.builtIn, collection)) {
    disabledReason = t(($) => $['panel.configureWorkspaceAuthorization'], { ns: 'workflow' })
  }

  return { disabledReason, usesAppUserAuth, authorization }
}
