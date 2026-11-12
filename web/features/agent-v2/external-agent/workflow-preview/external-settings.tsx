import type { ExternalAgentWorkflowWaitLimit } from './types'
import { Infotip, InfotipContent, InfotipTrigger } from '@langgenius/dify-ui/infotip'
import { Separator } from '@langgenius/dify-ui/separator'
import { useId, useState } from 'react'
import { useTranslation } from 'react-i18next'
import {
  Collapse,
  CollapseActions,
  CollapseContent,
  CollapseHeader,
  CollapseIndicator,
  CollapseTitle,
  CollapseTrigger,
} from '@/app/components/workflow/nodes/_base/components/collapse'
import ErrorHandleTypeSelector from '@/app/components/workflow/nodes/_base/components/error-handle/error-handle-type-selector'
import FailBranchCard from '@/app/components/workflow/nodes/_base/components/error-handle/fail-branch-card'
import { ErrorHandleTypeEnum } from '@/app/components/workflow/nodes/_base/components/error-handle/types'
import { ExternalAgentWaitLimit } from './wait-limit'

type ExternalAgentWorkflowSettingsProps = {
  waitLimit: ExternalAgentWorkflowWaitLimit
  onWaitLimitChange: (changes: Partial<ExternalAgentWorkflowWaitLimit>) => void
  errorStrategy: ErrorHandleTypeEnum
  onErrorStrategyChange: (strategy: ErrorHandleTypeEnum) => void
}

export function ExternalAgentWorkflowSettings({
  waitLimit,
  onWaitLimitChange,
  errorStrategy,
  onErrorStrategyChange,
}: ExternalAgentWorkflowSettingsProps) {
  const { t } = useTranslation(['agentRoster', 'workflow'])
  const errorHandlingTitleId = useId()
  const [errorHandlingCollapsed, setErrorHandlingCollapsed] = useState(false)
  const hasErrorStrategy = errorStrategy !== ErrorHandleTypeEnum.none

  return (
    <>
      <ExternalAgentWaitLimit value={waitLimit} onChange={onWaitLimitChange} />
      <div className="px-4 py-2">
        <Separator decorative className="my-0 bg-divider-subtle" />
      </div>
      <section className="pt-2 pb-4">
        <Collapse
          collapsed={errorHandlingCollapsed}
          onCollapse={setErrorHandlingCollapsed}
          disabled={!hasErrorStrategy}
        >
          <CollapseHeader>
            <CollapseTitle className="ms-4">
              <span id={errorHandlingTitleId}>
                {t(($) => $['nodes.common.errorHandle.title'], { ns: 'workflow' })}
              </span>
            </CollapseTitle>
            <Infotip>
              <InfotipTrigger aria-labelledby={errorHandlingTitleId} />
              <InfotipContent aria-labelledby={errorHandlingTitleId}>
                {t(($) => $['nodes.common.errorHandle.tip'], { ns: 'workflow' })}
              </InfotipContent>
            </Infotip>
            {hasErrorStrategy && (
              <CollapseTrigger
                aria-labelledby={errorHandlingTitleId}
                className="ms-0 size-6 justify-center"
              >
                <CollapseIndicator />
              </CollapseTrigger>
            )}
            <CollapseActions>
              <div className="pe-4">
                <ErrorHandleTypeSelector
                  value={errorStrategy}
                  onSelected={(strategy) => {
                    setErrorHandlingCollapsed(false)
                    onErrorStrategyChange(strategy)
                  }}
                />
              </div>
            </CollapseActions>
          </CollapseHeader>
          <CollapseContent>
            {errorStrategy === ErrorHandleTypeEnum.failBranch && (
              <FailBranchCard learnMorePlacement="below" />
            )}
            {errorStrategy === ErrorHandleTypeEnum.defaultValue && (
              <p className="px-4 pt-2 system-xs-regular text-text-tertiary">
                {t(($) => $['nodes.common.errorHandle.defaultValue.desc'], { ns: 'workflow' })}
              </p>
            )}
          </CollapseContent>
        </Collapse>
      </section>
    </>
  )
}
