import { Field, FieldLabel } from '@langgenius/dify-ui/field'
import { Infotip, InfotipContent, InfotipTrigger } from '@langgenius/dify-ui/infotip'
import {
  NumberField,
  NumberFieldGroup,
  NumberFieldInput,
  NumberFieldUnit,
} from '@langgenius/dify-ui/number-field'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectItemIndicator,
  SelectItemText,
  SelectLabel,
  SelectTrigger,
} from '@langgenius/dify-ui/select'
import { Separator } from '@langgenius/dify-ui/separator'
import {
  Slider,
  SliderControl,
  SliderIndicator,
  SliderLabel,
  SliderThumb,
  SliderTrack,
} from '@langgenius/dify-ui/slider'
import { Switch } from '@langgenius/dify-ui/switch'
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

type ExternalAgentWorkflowSettingsProps = {
  waitLimitEnabled: boolean
  waitLimitMinutes: number
  onWaitLimitEnabledChange: (enabled: boolean) => void
  onWaitLimitMinutesChange: (minutes: number) => void
  errorStrategy: ErrorHandleTypeEnum
  onErrorStrategyChange: (strategy: ErrorHandleTypeEnum) => void
}

export function ExternalAgentWorkflowSettings({
  waitLimitEnabled,
  waitLimitMinutes,
  onWaitLimitEnabledChange,
  onWaitLimitMinutesChange,
  errorStrategy,
  onErrorStrategyChange,
}: ExternalAgentWorkflowSettingsProps) {
  const { t } = useTranslation(['agentRoster', 'workflow'])
  const waitLimitTitleId = useId()
  const waitLimitLabelId = useId()
  const timeoutHelpId = useId()
  const errorHandlingTitleId = useId()
  const [errorHandlingCollapsed, setErrorHandlingCollapsed] = useState(false)
  const waitLimitLabel = t(($) => $['external.workflow.waitLimit.label'])
  const waitLimitHelp = t(($) => $['external.workflow.waitLimit.help'])
  const hasErrorStrategy = errorStrategy !== ErrorHandleTypeEnum.none

  const changeWaitLimit = (minutes: number | null) => {
    if (minutes !== null && Number.isFinite(minutes) && minutes > 0)
      onWaitLimitMinutesChange(minutes)
  }

  return (
    <>
      <section className="px-4 py-4">
        <Field name="external_agent_wait_limit_enabled" className="gap-0">
          <div className="flex min-h-6 items-center gap-1">
            <FieldLabel
              id={waitLimitTitleId}
              className="min-w-0 py-1 system-sm-semibold-uppercase text-text-secondary"
            >
              {t(($) => $['external.workflow.waitLimit.title'])}
            </FieldLabel>
            <Infotip>
              <InfotipTrigger aria-labelledby={waitLimitTitleId} />
              <InfotipContent aria-labelledby={waitLimitTitleId}>{waitLimitHelp}</InfotipContent>
            </Infotip>
            <Switch
              aria-labelledby={waitLimitTitleId}
              checked={waitLimitEnabled}
              onCheckedChange={onWaitLimitEnabledChange}
              className="ms-auto"
            />
          </div>
        </Field>
        {waitLimitEnabled && (
          <div className="mt-2 space-y-2">
            <div className="flex min-h-8 items-center justify-between gap-3">
              <span
                id={waitLimitLabelId}
                className="system-xs-regular text-text-tertiary uppercase"
              >
                {waitLimitLabel}
              </span>
              <div className="flex shrink-0 items-center gap-3">
                <Slider<number>
                  value={waitLimitMinutes}
                  min={Math.min(1, waitLimitMinutes)}
                  max={Math.max(30, waitLimitMinutes)}
                  step={1}
                  onValueChange={changeWaitLimit}
                  className="w-27"
                >
                  <SliderLabel className="sr-only">{waitLimitLabel}</SliderLabel>
                  <SliderControl>
                    <SliderTrack>
                      <SliderIndicator />
                      <SliderThumb />
                    </SliderTrack>
                  </SliderControl>
                </Slider>
                <Field name="external_agent_wait_limit_minutes" className="w-20 gap-0">
                  <FieldLabel className="sr-only">{waitLimitLabel}</FieldLabel>
                  <NumberField
                    value={waitLimitMinutes}
                    min={0}
                    step={1}
                    format={{ useGrouping: false }}
                    onValueChange={changeWaitLimit}
                  >
                    <NumberFieldGroup>
                      <NumberFieldInput aria-labelledby={waitLimitLabelId} className="ps-2 pe-1" />
                      <NumberFieldUnit>
                        {t(($) => $['external.workflow.waitLimit.unit'])}
                      </NumberFieldUnit>
                    </NumberFieldGroup>
                  </NumberField>
                </Field>
              </div>
            </div>
            <Select<'end-waiting'> value="end-waiting">
              <div className="flex min-h-8 items-center justify-between gap-3">
                <SelectLabel className="py-0 system-xs-regular text-text-tertiary uppercase">
                  {t(($) => $['external.workflow.waitLimit.onTimeout'])}
                </SelectLabel>
                <SelectTrigger aria-describedby={timeoutHelpId} className="w-50 shrink-0">
                  {t(($) => $['external.workflow.waitLimit.endWaiting'])}
                </SelectTrigger>
              </div>
              <SelectContent>
                <SelectItem value="end-waiting">
                  <SelectItemText>
                    {t(($) => $['external.workflow.waitLimit.endWaiting'])}
                  </SelectItemText>
                  <SelectItemIndicator />
                </SelectItem>
              </SelectContent>
            </Select>
            <p id={timeoutHelpId} className="system-xs-regular text-text-tertiary">
              {waitLimitHelp}
            </p>
          </div>
        )}
      </section>
      <Separator decorative className="my-0 bg-divider-subtle" />
      <section className="py-4">
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
