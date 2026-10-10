import type { PluginAuthProps } from '@/app/components/plugins/plugin-auth/plugin-auth'
import PluginAuth from '@/app/components/plugins/plugin-auth/plugin-auth'
import { useStore } from '@/app/components/workflow/store'

type ToolAuthorizationProps = Omit<
  PluginAuthProps,
  'authorizationTab' | 'onAuthorizationTabChange' | 'appUserAuth'
> & {
  nodeId: string
  providerId: string
}

const ToolAuthorization = ({ nodeId, providerId, ...props }: ToolAuthorizationProps) => {
  const provider = props.pluginPayload.provider
  const stored = useStore((state) => state.nodeAuthDrafts[nodeId])
  const setAuthorizationTab = useStore((state) => state.setNodeAuthorizationTab)
  const setDraft = useStore((state) => state.setNodeAppUserAuthDraft)
  const entry =
    stored?.provider === provider && stored.providerId === providerId ? stored : undefined

  return (
    <PluginAuth
      {...props}
      authorizationTab={entry?.authorizationTab ?? 'workspace-auth'}
      onAuthorizationTabChange={(tab) => setAuthorizationTab(nodeId, provider, providerId, tab)}
      appUserAuth={{
        draft: entry?.draft,
        onChange: (draft) => setDraft(nodeId, provider, providerId, draft),
      }}
    />
  )
}

export default ToolAuthorization
