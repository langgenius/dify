'use client'

import { Trans } from 'react-i18next'
import { useDocLink } from '@/context/i18n'
import { DocsLink } from './docs-link'

type AgentConfigureTipContentProps = {
  type: 'prompt' | 'skills' | 'files' | 'tools' | 'knowledge' | 'env'
}

export function AgentConfigureTipContent({ type }: AgentConfigureTipContentProps) {
  const docLink = useDocLink()

  if (type === 'prompt') {
    return (
      <Trans
        i18nKey={($) => $['agentDetail.configure.prompt.richTip']}
        ns="agentV2"
        components={{
          docLink: <DocsLink href={docLink('/use-dify/build/new-agent/build#prompt')} />,
        }}
      />
    )
  }

  if (type === 'env') {
    return (
      <span className="whitespace-pre-line">
        <Trans
          i18nKey={($) => $['agentDetail.configure.advancedSettings.envEditor.richTip']}
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
          i18nKey={($) => $['agentDetail.configure.skills.richTip']}
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
          i18nKey={($) => $['agentDetail.configure.tools.richTip']}
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
        i18nKey={($) => $['agentDetail.configure.knowledgeRetrieval.richTip']}
        ns="agentV2"
        components={{
          docLink: (
            <DocsLink href={docLink('/use-dify/build/new-agent/build#knowledge-retrieval')} />
          ),
        }}
      />
    )
  }

  if (type === 'files') {
    return (
      <span className="whitespace-pre-line">
        <Trans
          i18nKey={($) => $['agentDetail.configure.files.richTip']}
          ns="agentV2"
          components={{
            docLink: <DocsLink href={docLink('/use-dify/build/new-agent/build#files')} />,
          }}
        />
      </span>
    )
  }

  return null
}
