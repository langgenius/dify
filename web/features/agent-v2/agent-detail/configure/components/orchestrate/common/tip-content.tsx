'use client'

import type { ReactNode } from 'react'
import { Trans, useTranslation } from 'react-i18next'
import { useDocLink } from '@/context/i18n'

type AgentConfigureTipContentProps = {
  type: 'prompt' | 'skills' | 'files' | 'tools' | 'knowledge' | 'env'
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

  if (type === 'env') {
    return (
      <span className="whitespace-pre-line">
        <Trans
          i18nKey="agentDetail.configure.advancedSettings.envEditor.richTip"
          ns="agentV2"
          components={{
            docLink: <DocsLink href={docLink('/use-dify/build/agent')} />,
          }}
        />
      </span>
    )
  }

  if (type === 'skills') {
    return (
      <span className="whitespace-pre-line">
        <Trans
          i18nKey="agentDetail.configure.skills.richTip"
          ns="agentV2"
          components={{
            docLink: <DocsLink href={docLink('/use-dify/build/new-agent/build#skills')} />,
          }}
        />
      </span>
    )
  }

  if (type === 'tools') {
    return (
      <span className="whitespace-pre-line">
        <Trans
          i18nKey="agentDetail.configure.tools.richTip"
          ns="agentV2"
          components={{
            docLink: <DocsLink href={docLink('/use-dify/build/new-agent/build#tools')} />,
          }}
        />
      </span>
    )
  }

  if (type === 'knowledge') {
    return (
      <Trans
        i18nKey="agentDetail.configure.knowledgeRetrieval.richTip"
        ns="agentV2"
        components={{
          docLink: <DocsLink href={docLink('/use-dify/build/new-agent/build#knowledge-retrieval')} />,
        }}
      />
    )
  }

  if (type === 'files')
    return <span className="whitespace-pre-line">{t('agentDetail.configure.files.tip')}</span>

  return <>{t(`agentDetail.configure.${type}.tip`)}</>
}
