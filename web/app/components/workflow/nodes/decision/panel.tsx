import type { FC } from 'react'
import type { DecisionNodeType } from './types'
import type { NodePanelProps } from '@/app/components/workflow/types'
import {
  AlertDialog,
  AlertDialogCancelButton,
  AlertDialogConfirmButton,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@langgenius/dify-ui/alert-dialog'
import { Input } from '@langgenius/dify-ui/input'
import * as React from 'react'
import { useTranslation } from 'react-i18next'
import Field from '@/app/components/workflow/nodes/_base/components/field'
import OutputVars, { VarItem } from '@/app/components/workflow/nodes/_base/components/output-vars'
import Split from '@/app/components/workflow/nodes/_base/components/split'
import DecideBySelector from './components/decide-by-selector'
import ExtrasSection from './components/extras-section'
import IntentSection from './components/intent-section'
import LlmSection from './components/llm-section'
import OutcomeList from './components/outcome-list'
import { DecideBy } from './types'
import useConfig from './use-config'

const i18nPrefix = 'nodes.decision'

const Panel: FC<NodePanelProps<DecisionNodeType>> = ({ id, data }) => {
  const { t } = useTranslation(['common', 'workflow'])
  const config = useConfig(id, data)
  const {
    readOnly,
    inputs,
    handleIntentChange,
    handleDecideByChange,
    handleOtherwiseLabelChange,
    handleGenerate,
    handleConfirmReplace,
    handleCancelReplace,
    isGenerating,
    generateFeedback,
    suggestedReason,
    isConfirmReplaceOpen,
    isConfirmRemoveExtraOpen,
    handleConfirmRemoveExtra,
    handleCancelRemoveExtra,
    extraKeys,
  } = config

  return (
    <div className="pt-2">
      <div className="space-y-1 px-1">
        <IntentSection
          intent={inputs.intent}
          readonly={readOnly}
          isGenerating={isGenerating}
          feedback={generateFeedback}
          isEmpty={!inputs.outcomes.some((outcome) => outcome.label)}
          onChange={handleIntentChange}
          onGenerate={handleGenerate}
        />
        <Split />
        <Field
          title={t(($) => $[`${i18nPrefix}.currentRules`], { ns: 'workflow' })}
          className="px-4 py-2"
        >
          <div className="mb-2">
            <div className="mb-1 system-xs-medium-uppercase text-text-tertiary">
              {t(($) => $[`${i18nPrefix}.decideByTitle`], { ns: 'workflow' })}
            </div>
            <DecideBySelector
              value={inputs.decide_by}
              // A pending Generate can rewrite every outcome; the mode must
              // not change while the request is in flight.
              readonly={readOnly || isGenerating}
              onChange={handleDecideByChange}
            />
            {!!suggestedReason && (
              <div className="mt-1 text-xs leading-4 font-normal text-text-tertiary">
                {t(($) => $[`${i18nPrefix}.suggested`], { ns: 'workflow' })} {suggestedReason}
              </div>
            )}
          </div>
        </Field>
        {inputs.decide_by === DecideBy.llm && (
          <LlmSection nodeId={id} inputs={inputs} config={config} />
        )}
        <OutcomeList nodeId={id} config={config} />
        <div className="px-4 py-2">
          <div className="text-xs leading-4 font-normal text-text-tertiary">
            {t(($) => $[`${i18nPrefix}.otherwiseCaption`], { ns: 'workflow' })}
          </div>
          <Input
            className="mt-1 h-7 text-xs"
            value={inputs.otherwise.label}
            disabled={readOnly}
            aria-label={t(($) => $[`${i18nPrefix}.otherwiseLabel`], { ns: 'workflow' })}
            placeholder={t(($) => $[`${i18nPrefix}.otherwiseDefault`], { ns: 'workflow' })}
            onChange={(e) => handleOtherwiseLabelChange(e.target.value)}
          />
        </div>
        <ExtrasSection config={config} />
      </div>
      <Split />
      <div>
        <OutputVars>
          <>
            <VarItem
              name="outcome"
              type="string"
              description={t(($) => $[`${i18nPrefix}.outputVars.outcome`], { ns: 'workflow' })}
            />
            <VarItem
              name="outcome_id"
              type="string"
              description={t(($) => $[`${i18nPrefix}.outputVars.outcomeId`], { ns: 'workflow' })}
            />
            <VarItem
              name="reason"
              type="string"
              description={t(($) => $[`${i18nPrefix}.outputVars.reason`], { ns: 'workflow' })}
            />
            <VarItem
              name="decided_by"
              type="string"
              description={t(($) => $[`${i18nPrefix}.outputVars.decidedBy`], { ns: 'workflow' })}
            />
            {inputs.extras.map((extra, index) =>
              extra.name ? (
                <VarItem
                  key={extraKeys[index]}
                  name={extra.name}
                  type="string"
                  description={t(($) => $[`${i18nPrefix}.outputVars.extra`], { ns: 'workflow' })}
                />
              ) : null,
            )}
          </>
        </OutputVars>
      </div>
      <AlertDialog
        open={isConfirmReplaceOpen}
        onOpenChange={(open) => !open && handleCancelReplace()}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              {t(($) => $[`${i18nPrefix}.replaceRulesTitle`], { ns: 'workflow' })}
            </AlertDialogTitle>
            <AlertDialogDescription>
              {t(($) => $[`${i18nPrefix}.replaceRulesDescription`], { ns: 'workflow' })}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancelButton>
              {t(($) => $['operation.cancel'], { ns: 'common' })}
            </AlertDialogCancelButton>
            <AlertDialogConfirmButton onClick={handleConfirmReplace}>
              {t(($) => $['operation.confirm'], { ns: 'common' })}
            </AlertDialogConfirmButton>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
      <AlertDialog
        open={isConfirmRemoveExtraOpen}
        onOpenChange={(open) => !open && handleCancelRemoveExtra()}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              {t(($) => $[`${i18nPrefix}.removeExtraTitle`], { ns: 'workflow' })}
            </AlertDialogTitle>
            <AlertDialogDescription>
              {t(($) => $[`${i18nPrefix}.removeExtraDescription`], { ns: 'workflow' })}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancelButton>
              {t(($) => $['operation.cancel'], { ns: 'common' })}
            </AlertDialogCancelButton>
            <AlertDialogConfirmButton onClick={handleConfirmRemoveExtra}>
              {t(($) => $['operation.confirm'], { ns: 'common' })}
            </AlertDialogConfirmButton>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  )
}

export default React.memo(Panel)
