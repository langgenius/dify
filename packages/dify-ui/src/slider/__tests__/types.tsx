import type { SliderValueProps } from '@langgenius/dify-ui/slider'
import { Slider, SliderValue } from '@langgenius/dify-ui/slider'
import { expectTypeOf } from 'vite-plus/test'

function sliderTypeContracts() {
  const single = (
    <Slider
      defaultValue={0.9}
      onValueChange={(value) => {
        expectTypeOf(value).toEqualTypeOf<number>()
      }}
    />
  )

  const initialRange: readonly [number, number] = [25, 75]
  const range = (
    <Slider
      defaultValue={initialRange}
      onValueChange={(value) => {
        expectTypeOf(value).toEqualTypeOf<readonly [number, number]>()
      }}
    />
  )

  const renderValue: NonNullable<SliderValueProps['children']> = (formattedValues) =>
    formattedValues.join(' – ')
  const output = <SliderValue>{renderValue}</SliderValue>

  // @ts-expect-error Slider only supports numeric values and ranges.
  const invalid = <Slider defaultValue="0.9" />

  return [single, range, output, invalid]
}

void sliderTypeContracts
