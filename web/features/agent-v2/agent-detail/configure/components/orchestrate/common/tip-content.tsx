'use client'

import type { ReactNode } from 'react'
import { Trans, useTranslation } from 'react-i18next'
import { useDocLink } from '@/context/i18n'

type AgentConfigureTipContentProps = {
  type: 'prompt' | 'skills' | 'files' | 'tools'
}

function DocsLink({
  children,
  href,
}: {
  children?: ReactNode
  href: string
}) {
  return (
    <a
      href={href}
      target="_blank"
      rel="noopener noreferrer"
      className="text-text-accent hover:underline"
    >
      {children}
    </a>
  )
}

export function AgentConfigureTipContent({ type }: AgentConfigureTipContentProps) {
  const { t } = useTranslation('agentV2')
  const docLink = useDocLink()

  if (type === 'skills') {
    return (
      <Trans
        i18nKey="agentDetail.configure.skills.richTip"
        ns="agentV2"
        components={{
          docLink: <DocsLink href={docLink()} />,
        }}
      />
    )
  }

  if (type === 'tools') {
    return (
      <span className="whitespace-pre-line">
        <Trans
          i18nKey="agentDetail.configure.tools.richTip"
          ns="agentV2"
          components={{
            pluginDocLink: <DocsLink href={docLink('/develop-plugin/getting-started/getting-started-dify-plugin')} />,
            buildDocLink: <DocsLink href={docLink('/use-dify/build/agent')} />,
          }}
        />
      </span>
    )
  }

  return <>{t(`agentDetail.configure.${type}.tip`)}</>
}
