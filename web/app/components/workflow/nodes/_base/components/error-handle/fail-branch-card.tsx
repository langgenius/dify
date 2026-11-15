import { RiMindMap } from '@remixicon/react'
import { useTranslation } from 'react-i18next'
import { useDocLink } from '@/context/i18n'

const FailBranchCard = ({
  learnMorePlacement = 'inline',
}: {
  learnMorePlacement?: 'inline' | 'below'
}) => {
  const { t } = useTranslation(['workflow'])
  const docLink = useDocLink()
  const learnMore = (
    <a
      href={docLink('/use-dify/debug/error-type')}
      target="_blank"
      rel="noopener noreferrer"
      className="inline-flex items-center gap-1 rounded-sm text-text-accent focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-components-input-border-active"
    >
      {t(($) => $['common.learnMore'], { ns: 'workflow' })}
      {learnMorePlacement === 'below' && (
        <span aria-hidden className="i-ri-arrow-right-up-line size-3" />
      )}
    </a>
  )

  return (
    <div className="px-4 pt-2">
      <div className="rounded-[10px] bg-workflow-process-bg p-4">
        <div className="mb-2 flex h-8 w-8 items-center justify-center rounded-[10px] border-[0.5px] border-components-card-border bg-components-card-bg shadow-lg">
          <RiMindMap className="size-5 text-text-tertiary" />
        </div>
        <div className="mb-1 system-sm-medium text-text-secondary">
          {t(($) => $['nodes.common.errorHandle.failBranch.customize'], { ns: 'workflow' })}
        </div>
        <div className="system-xs-regular text-text-tertiary">
          {t(($) => $['nodes.common.errorHandle.failBranch.customizeTip'], { ns: 'workflow' })}
          {learnMorePlacement === 'inline' && <> {learnMore}</>}
        </div>
      </div>
      {learnMorePlacement === 'below' && <div className="mt-2 system-xs-medium">{learnMore}</div>}
    </div>
  )
}

export default FailBranchCard
