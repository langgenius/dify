'use client'

import type { DocPathWithoutLang } from '@/types/doc-paths'
import { useTranslation } from 'react-i18next'
import { useDocLink } from '@/context/i18n'

type DocLearnMoreLinkProps = {
  path: DocPathWithoutLang
}

const DocLearnMoreLink = ({ path }: DocLearnMoreLinkProps) => {
  const { t } = useTranslation(['common'])
  const docLink = useDocLink()

  return (
    <a
      className="rounded-sm text-text-accent hover:underline focus-visible:ring-2 focus-visible:ring-state-accent-solid focus-visible:outline-hidden"
      href={docLink(path)}
      target="_blank"
      rel="noopener noreferrer"
    >
      {t(($) => $['operation.learnMore'])}
    </a>
  )
}

export default DocLearnMoreLink
