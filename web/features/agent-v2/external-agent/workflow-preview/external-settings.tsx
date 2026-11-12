import type { ExternalAgentWorkflowPreviewNodeData, ExternalAgentWorkflowWaitLimit } from './types'
import { Infotip, InfotipContent, InfotipTrigger } from '@langgenius/dify-ui/infotip'
import { Separator } from '@langgenius/dify-ui/separator'
import { useId } from 'react'
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
import DefaultValue from '@/app/components/workflow/nodes/_base/components/error-handle/default-value'
import ErrorHandleTypeSelector from '@/app/components/workflow/nodes/_base/components/error-handle/error-handle-type-selector'
import FailBranchCard from '@/app/components/workflow/nodes/_base/components/error-handle/fail-branch-card'
import {
  useDefaultValue,
  useErrorHandle,
} from '@/app/components/workflow/nodes/_base/components/error-handle/hooks'
import { ErrorHandleTypeEnum } from '@/app/components/workflow/nodes/_base/components/error-handle/types'
import { externalAgentDefaultWaitLimit } from './preview'
import { ExternalAgentWaitLimit } from './wait-limit'

type ExternalAgentWorkflowSettingsProps = {
  id: string
  data: ExternalAgentWorkflowPreviewNodeData
  onWaitLimitChange: (changes: Partial<ExternalAgentWorkflowWaitLimit>) => void
}

export function ExternalAgentWorkflowSettings({
  id,
  data,
  onWaitLimitChange,
}: ExternalAgentWorkflowSettingsProps) {
  const { t } = useTranslation(['workflow'])
  const errorHandlingTitleId = useId()
  const { error_strategy, default_value } = data
  const { collapsed, setCollapsed, handleErrorHandleTypeChange } = useErrorHandle(id, data)
  const { handleFormChange } = useDefaultValue(id)
  const waitLimit = { ...externalAgentDefaultWaitLimit, ...data.external_agent_wait_limit }

  return (
    <>
      <ExternalAgentWaitLimit value={waitLimit} onChange={onWaitLimitChange} />
      <div className="px-4 py-2">
        <Separator decorative className="my-0 bg-divider-subtle" />
      </div>
      <section className="pt-2 pb-4">
        <Collapse collapsed={collapsed} onCollapse={setCollapsed} disabled={!error_strategy}>
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
            {!!error_strategy && (
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
                  value={error_strategy || ErrorHandleTypeEnum.none}
                  onSelected={(strategy) => handleErrorHandleTypeChange(strategy, data)}
                />
              </div>
            </CollapseActions>
          </CollapseHeader>
          <CollapseContent>
            {error_strategy === ErrorHandleTypeEnum.failBranch && !collapsed && (
              <FailBranchCard learnMorePlacement="below" />
            )}
            {error_strategy === ErrorHandleTypeEnum.defaultValue &&
              !collapsed &&
              !!default_value?.length && (
                <DefaultValue
                  forms={default_value}
                  onFormChange={(form) => handleFormChange(form, data)}
                />
              )}
          </CollapseContent>
        </Collapse>
      </section>
    </>
  )
}
