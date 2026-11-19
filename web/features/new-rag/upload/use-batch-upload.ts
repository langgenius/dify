import { useQuery } from '@tanstack/react-query'
import { useAtomValue } from 'jotai'
import { deploymentEditionAtom } from '@/features/system-features/state'
import { consoleQuery } from '@/service/console'

export function useKnowledgeBatchUpload() {
  const deploymentEdition = useAtomValue(deploymentEditionAtom)
  const { data: plan } = useQuery(
    consoleQuery.features.get.queryOptions({
      enabled: deploymentEdition === 'CLOUD',
      select: (data) => data.billing.subscription.plan,
    }),
  )

  // Match the legacy RAG uploader, including the conservative loading/error fallback.
  return deploymentEdition !== 'CLOUD' || plan === 'professional' || plan === 'team'
}
