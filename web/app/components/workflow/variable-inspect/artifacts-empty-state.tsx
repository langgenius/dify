import type { DocPathWithoutLang } from '@/types/doc-paths'
import { useTranslation } from 'react-i18next'
import SearchLinesSparkle from '@/app/components/base/icons/src/vender/knowledge/SearchLinesSparkle'
import { useDocLink } from '@/context/i18n'

const fileSystemArtifactsLocalizedPathMap = {
  'zh-Hans': '/use-dify/build/file-system#产物' as DocPathWithoutLang,
  'zh_Hans': '/use-dify/build/file-system#产物' as DocPathWithoutLang,
  'ja-JP': '/use-dify/build/file-system#アーティファクト' as DocPathWithoutLang,
  'ja_JP': '/use-dify/build/file-system#アーティファクト' as DocPathWithoutLang,
}

type Props = {
  description: string
}

export default function ArtifactsEmptyState({ description }: Props) {
  const { t } = useTranslation('workflow')
  const docLink = useDocLink()

  return (
    <div className="flex h-full flex-col gap-3 rounded-xl bg-background-section p-8">
      <div className="flex h-10 w-10 items-center justify-center rounded-[10px] border-[0.5px] border-components-card-border bg-components-card-bg shadow-lg backdrop-blur-sm">
        <SearchLinesSparkle className="h-5 w-5 text-text-accent" aria-hidden="true" />
      </div>
      <div className="flex flex-col gap-1">
        <div className="text-text-secondary system-sm-semibold">{t('debug.variableInspect.tabArtifacts.emptyTitle')}</div>
        <div className="text-text-tertiary system-xs-regular">{description}</div>
        <a
          className="cursor-pointer text-text-accent system-xs-regular"
          href={docLink('/use-dify/build/file-system#artifacts' as DocPathWithoutLang, fileSystemArtifactsLocalizedPathMap)}
          target="_blank"
          rel="noopener noreferrer"
        >
          {t('debug.variableInspect.tabArtifacts.emptyLink')}
        </a>
      </div>
    </div>
  )
}
