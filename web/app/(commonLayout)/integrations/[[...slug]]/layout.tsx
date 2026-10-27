import type { PropsWithChildren } from 'react'
import type { IntegrationSection } from '@/app/components/integrations/routes'
import type { Metadata } from '@/next'
import { getIntegrationRouteTargetBySlug } from '@/app/components/integrations/routes'
import { getLocaleOnServer, getTranslation } from '@/i18n/server'

type IntegrationsRouteLayoutProps = PropsWithChildren<{
  params: Promise<{
    slug?: string[]
  }>
}>

const getIntegrationSectionTitle = async (section: IntegrationSection) => {
  const locale = await getLocaleOnServer()

  if (section === 'mcp') return 'MCP'
  if (section === 'workflow-tool') {
    const { t } = await getTranslation(locale, 'navigation')
    return t(($) => $['common.workflowAsTool'], { ns: 'navigation' })
  }
  if (section === 'trigger' || section === 'agent-strategy' || section === 'extension') {
    const { t } = await getTranslation(locale, 'plugin')
    if (section === 'trigger') return t(($) => $['categorySingle.trigger'], { ns: 'plugin' })
    if (section === 'agent-strategy') return t(($) => $['categorySingle.agent'], { ns: 'plugin' })
    return t(($) => $['categorySingle.extension'], { ns: 'plugin' })
  }

  const { t } = await getTranslation(locale, 'navigation')
  if (section === 'provider') return t(($) => $['settings.provider'], { ns: 'navigation' })
  if (section === 'builtin') return t(($) => $['toolsPage.toolPlugin'], { ns: 'navigation' })
  if (section === 'custom-tool')
    return t(($) => $['settings.swaggerAPIAsTool'], { ns: 'navigation' })
  if (section === 'data-source') return t(($) => $['settings.dataSource'], { ns: 'navigation' })
  return t(($) => $['settings.customEndpoint'], { ns: 'navigation' })
}

export async function generateMetadata({
  params,
}: IntegrationsRouteLayoutProps): Promise<Metadata> {
  const { slug } = await params
  const target = getIntegrationRouteTargetBySlug(slug)
  const locale = await getLocaleOnServer()
  const { t } = await getTranslation(locale, 'navigation')
  const integrationsTitle = t(($) => $['mainNav.integrations'], { ns: 'navigation' })

  if (target.type !== 'section') return { title: integrationsTitle }

  return { title: `${await getIntegrationSectionTitle(target.section)} · ${integrationsTitle}` }
}

export default function IntegrationsRouteLayout({ children }: IntegrationsRouteLayoutProps) {
  return children
}
