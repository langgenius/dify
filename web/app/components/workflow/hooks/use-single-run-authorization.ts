import type { Node } from '../types'
import { useQuery } from '@tanstack/react-query'
import { useTranslation } from 'react-i18next'
import { CollectionType } from '@/app/components/tools/types'
import { selectToolsWithProvider } from '@/app/components/tools/utils/query-select'
import { consoleQuery } from '@/service/console'
import { matchesProviderReference } from '@/utils/provider-reference'
import { isToolAuthorizationRequired } from '../nodes/tool/auth'
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
  const storedDraft = useStore((state) => state.nodeAuthDrafts[id])
  const collection = (builtInTools ?? storedTools)?.find((tool) =>
    matchesProviderReference(tool, data.provider_id),
  )
  const draft =
    isBuiltInTool &&
    collection?.allow_delete &&
    storedDraft &&
    storedDraft.providerId === data.provider_id &&
    storedDraft.provider === collection.name
      ? storedDraft
      : undefined
  const usesAppUserAuth = draft?.authorizationTab === 'app-user-auth'
  let disabledReason: string | undefined

  if (usesAppUserAuth) {
    // An absent test draft displays the initial mock connections. An explicitly
    // empty list remains empty, including after the last connection is removed.
    if (draft.draft?.testConnection?.connections.length === 0)
      disabledReason = t(($) => $['panel.configureTestRunConnection'], { ns: 'workflow' })
  } else if (draft?.authorizationTab === 'reuse-from-node') {
    if (!draft.reuseFromNode?.source.id)
      disabledReason = t(($) => $['panel.selectReuseNode'], { ns: 'workflow' })
  } else if (
    (!draft || draft.authorizationTab === 'workspace-auth') &&
    isBuiltInTool &&
    isToolAuthorizationRequired(CollectionType.builtIn, collection)
  ) {
    disabledReason = t(($) => $['panel.configureWorkspaceAuthorization'], { ns: 'workflow' })
  }

  return { disabledReason, usesAppUserAuth }
}
