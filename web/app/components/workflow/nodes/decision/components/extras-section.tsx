import type { FC, KeyboardEvent } from 'react'
import type { ExtraSource, Outcome } from '../types'
import type { DecisionConfig } from '../use-config'
import { IconButton } from '@langgenius/dify-ui/icon-button'
import { Input } from '@langgenius/dify-ui/input'
import { SegmentedControl, SegmentedControlItem } from '@langgenius/dify-ui/segmented-control'
import { useId, useState } from 'react'
import { useTranslation } from 'react-i18next'
import AddButton from '@/app/components/workflow/nodes/_base/components/add-button'
import Field from '@/app/components/workflow/nodes/_base/components/field'
import { DecideBy } from '../types'
import { getExtraNameError } from '../utils'

const i18nPrefix = 'nodes.decision'

const extraNameErrorKey = {
  required: 'extraNameErrorRequired',
  invalid: 'extraNameErrorInvalid',
  duplicate: 'extraNameErrorDuplicate',
  reserved: 'extraNameErrorReserved',
} as const

type ExtrasSectionProps = {
  config: DecisionConfig
}

// The name input commits on blur and on Enter: while typing it holds a local
// draft, so an intermediate empty or invalid value never enters node data and
// cannot strand the downstream references a committed name owns.
const ExtraNameInput: FC<{
  extras: DecisionConfig['inputs']['extras']
  index: number
  disabled: boolean
  onCommit: (index: number, name: string) => void
}> = ({ extras, index, disabled, onCommit }) => {
  const { t } = useTranslation(['workflow'])
  const label = t(($) => $[`${i18nPrefix}.extraNameLabel`], { ns: 'workflow' })
  const errorId = useId()
  const committed = extras[index]?.name ?? ''
  const [state, setState] = useState({ draft: committed, committed })

  // The committed name can change outside this input (undo, a generated
  // configuration, our own successful commit); the draft follows it.
  if (state.committed !== committed) setState({ draft: committed, committed })

  const nameError = getExtraNameError(
    extras.map((extra, i) => (i === index ? { ...extra, name: state.draft } : extra)),
    index,
  )

  const commit = () => {
    if (disabled) return
    if (state.draft !== committed) onCommit(index, state.draft)
  }

  const handleKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter' && !e.nativeEvent.isComposing) {
      e.preventDefault()
      commit()
    }
  }

  return (
    <div className="flex min-w-0 grow flex-col">
      <Input
        className="h-7 grow text-xs font-semibold"
        value={state.draft}
        disabled={disabled}
        aria-label={label}
        aria-invalid={nameError ? true : undefined}
        aria-describedby={nameError ? errorId : undefined}
        placeholder={t(($) => $[`${i18nPrefix}.extraNamePlaceholder`], { ns: 'workflow' })}
        onChange={(e) => setState({ draft: e.target.value, committed })}
        onBlur={commit}
        onKeyDown={handleKeyDown}
      />
      {nameError && (
        <div id={errorId} className="mt-1 text-xs leading-4 font-normal text-text-destructive">
          {t(($) => $[`${i18nPrefix}.${extraNameErrorKey[nameError]}`], { ns: 'workflow' })}
        </div>
      )}
    </div>
  )
}

const ExtrasSection: FC<ExtrasSectionProps> = ({ config }) => {
  const { t } = useTranslation(['common', 'workflow'])
  const {
    readOnly,
    inputs,
    extraKeys,
    handleAddExtra,
    handleRemoveExtra,
    handleCommitExtraName,
    handleUpdateExtraSource,
    handleUpdateExtraValue,
    handleUpdateExtraHint,
  } = config

  const outcomeLabel = (outcome: Outcome) =>
    outcome.label || t(($) => $[`${i18nPrefix}.outcomePlaceholder`], { ns: 'workflow' })

  return (
    <Field
      title={t(($) => $[`${i18nPrefix}.extrasTitle`], { ns: 'workflow' })}
      className="px-4 py-2"
    >
      <>
        <div className="mb-2 text-xs leading-4 font-normal text-text-tertiary">
          {t(($) => $[`${i18nPrefix}.extrasHelper`], { ns: 'workflow' })}
        </div>
        <div className="space-y-2">
          {inputs.extras.map((extra, index) => {
            return (
              <div
                key={extraKeys[index]}
                className="rounded-[10px] bg-components-panel-bg px-3 py-2"
              >
                <div className="flex items-center gap-1">
                  <ExtraNameInput
                    extras={inputs.extras}
                    index={index}
                    disabled={readOnly}
                    onCommit={handleCommitExtraName}
                  />
                  <IconButton
                    size="sm"
                    variant="ghost"
                    disabled={readOnly}
                    aria-label={t(($) => $['operation.remove'], { ns: 'common' })}
                    onClick={() => handleRemoveExtra(index)}
                  >
                    <span aria-hidden="true" className="i-ri-delete-bin-line size-3.5" />
                  </IconButton>
                </div>
                <SegmentedControl<ExtraSource>
                  aria-label={t(($) => $[`${i18nPrefix}.extraSourceLabel`], { ns: 'workflow' })}
                  value={extra.from}
                  onValueChange={(next) => {
                    if (!readOnly) handleUpdateExtraSource(index, next)
                  }}
                  className="mt-2 w-full"
                >
                  <SegmentedControlItem value="fixed" disabled={readOnly}>
                    {t(($) => $[`${i18nPrefix}.extraSourceFixed`], { ns: 'workflow' })}
                  </SegmentedControlItem>
                  <SegmentedControlItem value="model" disabled={readOnly}>
                    {t(($) => $[`${i18nPrefix}.extraSourceModel`], { ns: 'workflow' })}
                  </SegmentedControlItem>
                </SegmentedControl>
                {extra.from === 'fixed' ? (
                  <div className="mt-2 space-y-1">
                    {inputs.outcomes.map((outcome) => (
                      <div key={outcome.id} className="flex items-center gap-2">
                        <div className="w-24 shrink-0 truncate text-xs leading-4 font-normal text-text-tertiary">
                          {outcomeLabel(outcome)}
                        </div>
                        <Input
                          className="h-7 grow text-xs"
                          value={extra.values?.[outcome.id] ?? ''}
                          disabled={readOnly}
                          aria-label={outcomeLabel(outcome)}
                          onChange={(e) =>
                            handleUpdateExtraValue(index, outcome.id, e.target.value)
                          }
                        />
                      </div>
                    ))}
                  </div>
                ) : (
                  <>
                    <Input
                      className="mt-2 h-7 text-xs"
                      value={extra.hint ?? ''}
                      disabled={readOnly}
                      aria-label={t(($) => $[`${i18nPrefix}.extraHintLabel`], { ns: 'workflow' })}
                      placeholder={t(($) => $[`${i18nPrefix}.extraHintPlaceholder`], {
                        ns: 'workflow',
                      })}
                      onChange={(e) => handleUpdateExtraHint(index, e.target.value)}
                    />
                    {inputs.decide_by === DecideBy.rules && (
                      <div className="mt-1 text-xs leading-4 font-normal text-text-tertiary">
                        {t(($) => $[`${i18nPrefix}.extraModelNeedsLlm`], { ns: 'workflow' })}
                      </div>
                    )}
                  </>
                )}
              </div>
            )
          })}
        </div>
        {!readOnly && (
          <div className="mt-2">
            <AddButton
              onClick={handleAddExtra}
              text={t(($) => $[`${i18nPrefix}.addExtra`], { ns: 'workflow' })}
            />
          </div>
        )}
      </>
    </Field>
  )
}

export default ExtrasSection
