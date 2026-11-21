import type { FC } from 'react'
import { SegmentedControl, SegmentedControlItem } from '@langgenius/dify-ui/segmented-control'
import { useTranslation } from 'react-i18next'
import { DecideBy } from '../types'

const i18nPrefix = 'nodes.decision'

type DecideBySelectorProps = {
  value: DecideBy
  readonly: boolean
  onChange: (value: DecideBy) => void
}

const DecideBySelector: FC<DecideBySelectorProps> = ({ value, readonly, onChange }) => {
  const { t } = useTranslation(['workflow'])

  return (
    <SegmentedControl<DecideBy>
      aria-label={t(($) => $[`${i18nPrefix}.decideByTitle`], { ns: 'workflow' })}
      value={value}
      onValueChange={(next) => {
        if (!readonly) onChange(next)
      }}
      className="w-full"
    >
      <SegmentedControlItem value={DecideBy.rules} disabled={readonly}>
        {t(($) => $[`${i18nPrefix}.decideBy.rules`], { ns: 'workflow' })}
      </SegmentedControlItem>
      <SegmentedControlItem value={DecideBy.llm} disabled={readonly}>
        {t(($) => $[`${i18nPrefix}.decideBy.llm`], { ns: 'workflow' })}
      </SegmentedControlItem>
      <SegmentedControlItem value={DecideBy.decisionModel} disabled>
        <span className="inline-flex items-center gap-1">
          {t(($) => $[`${i18nPrefix}.decideBy.decisionModel`], { ns: 'workflow' })}
          <span className="system-3xs-regular text-text-quaternary">
            {t(($) => $[`${i18nPrefix}.decideBy.comingSoon`], { ns: 'workflow' })}
          </span>
        </span>
      </SegmentedControlItem>
    </SegmentedControl>
  )
}

export default DecideBySelector
