import {
  Slider,
  SliderControl,
  SliderIndicator,
  SliderLabel,
  SliderThumb,
  SliderTrack,
} from '@langgenius/dify-ui/slider'
import { noop } from 'es-toolkit/function'
import { memo } from 'react'
import { useTranslation } from 'react-i18next'

const formatNumber = (value: number) => {
  if (value > 0 && value < 1) return `0.${value * 10}`
  else if (value === 1) return '1.0'

  return value
}

type Value = {
  value: number[]
}

type WeightedScoreProps = {
  value: Value
  onChange: (value: Value) => void
  readonly?: boolean
}
const WeightedScore = ({ value, onChange = noop, readonly = false }: WeightedScoreProps) => {
  const { t } = useTranslation()
  const semanticLabel = t(($) => $['weightedScore.semantic'], { ns: 'dataset' })
  const keywordLabel = t(($) => $['weightedScore.keyword'], { ns: 'dataset' })
  const semanticWeight = value.value[0]!
  const keywordWeight = value.value[1]!

  return (
    <div>
      <div className="space-x-3 rounded-lg border border-components-panel-border px-3 pt-5 pb-2">
        <div className="grow">
          <Slider
            className="grow"
            max={1.0}
            min={0}
            step={0.1}
            value={semanticWeight}
            onValueChange={(v) => !readonly && onChange({ value: [v, (10 - v * 10) / 10] })}
            disabled={readonly}
          >
            <SliderLabel className="sr-only">{semanticLabel}</SliderLabel>
            <SliderControl>
              <SliderTrack className="bg-util-colors-teal-teal-500">
                <SliderIndicator className="bg-util-colors-blue-light-blue-light-500" />
                <SliderThumb
                  getAriaValueText={(_formattedValue, sliderValue) =>
                    `${semanticLabel}: ${formatNumber(sliderValue)}, ${keywordLabel}: ${formatNumber((10 - sliderValue * 10) / 10)}`
                  }
                />
              </SliderTrack>
            </SliderControl>
          </Slider>
        </div>
        <div className="mt-3 flex justify-between">
          <div className="flex w-22.5 shrink-0 items-center system-xs-semibold-uppercase text-util-colors-blue-light-blue-light-500">
            <div className="mr-1 truncate uppercase" title={semanticLabel || ''}>
              {semanticLabel}
            </div>
            {formatNumber(semanticWeight)}
          </div>
          <div className="flex w-22.5 shrink-0 items-center justify-end system-xs-semibold-uppercase text-util-colors-teal-teal-500">
            {formatNumber(keywordWeight)}
            <div className="ml-1 truncate uppercase" title={keywordLabel || ''}>
              {keywordLabel}
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}

export default memo(WeightedScore)
