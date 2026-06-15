import { SegmentedControl, SegmentedControlItem } from '@langgenius/dify-ui/segmented-control'
import { useTranslation } from 'react-i18next'
import { AUTO_UPDATE_STRATEGY } from './types'

const i18nPrefix = 'autoUpdate.strategy'

type Props = Readonly<{
  value: AUTO_UPDATE_STRATEGY
  onChange: (value: AUTO_UPDATE_STRATEGY) => void
}>
const StrategyPicker = ({
  value,
  onChange,
}: Props) => {
  const { t } = useTranslation()
  const options = [
    {
      value: AUTO_UPDATE_STRATEGY.disabled,
      label: t(`${i18nPrefix}.disabled.name`, { ns: 'plugin' }),
    },
    {
      value: AUTO_UPDATE_STRATEGY.fixOnly,
      label: t(`${i18nPrefix}.fixOnly.name`, { ns: 'plugin' }),
    },
    {
      value: AUTO_UPDATE_STRATEGY.latest,
      label: t(`${i18nPrefix}.latest.name`, { ns: 'plugin' }),
    },
  ]

  return (
    <SegmentedControl<AUTO_UPDATE_STRATEGY>
      aria-label={t('autoUpdate.automaticUpdates', { ns: 'plugin' })}
      className="w-[326px]"
      value={[value]}
      onValueChange={(nextValue) => {
        const selectedValue = nextValue[0]
        if (selectedValue)
          onChange(selectedValue)
      }}
    >
      {options.map(option => (
        <SegmentedControlItem<AUTO_UPDATE_STRATEGY>
          key={option.value}
          value={option.value}
          className="flex-1 hover:bg-state-base-hover-alt data-pressed:text-text-accent-light-mode-only data-pressed:hover:bg-components-segmented-control-item-active-bg"
        >
          <span className="p-0.5 whitespace-nowrap">{option.label}</span>
        </SegmentedControlItem>
      ))}
    </SegmentedControl>
  )
}

export default StrategyPicker
