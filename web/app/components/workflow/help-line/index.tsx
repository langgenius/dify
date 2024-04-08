import { memo } from 'react'
import { useViewport } from 'reactflow'
import { useStore } from '../store'
import type {
  HelpLineHorizontalPosition,
  HelpLineVerticalPosition,
} from './types'

const HelpLineHorizontal = memo(({
  top,
  left,
  width,
}: HelpLineHorizontalPosition) => {
  const { x, y, zoom } = useViewport()

  return (
    <div
      className='absolute h-[1px] bg-primary-300 z-[9]'
      style={{
        top: top * zoom + y,
        left: left * zoom + x,
        width: width * zoom,
      }}
    />
  )
})
HelpLineHorizontal.displayName = 'HelpLineBase'

const HelpLineVertical = memo(({
  top,
  left,
  height,
}: HelpLineVerticalPosition) => {
  const { x, y, zoom } = useViewport()

  return (
    <div
      className='absolute w-[1px] bg-primary-300 z-[9]'
      style={{
        top: top * zoom + y,
        left: left * zoom + x,
        height: height * zoom,
      }}
    />
  )
})
HelpLineVertical.displayName = 'HelpLineVertical'

const HelpLine = () => {
  const helpLineHorizontal = useStore(s => s.helpLineHorizontal)
  const helpLineVertical = useStore(s => s.helpLineVertical)

  if (!helpLineHorizontal && !helpLineVertical)
    return null

  return (
    <>
      {
        helpLineHorizontal && (
          <HelpLineHorizontal {...helpLineHorizontal} />
        )
      }
      {
        helpLineVertical && (
          <HelpLineVertical {...helpLineVertical} />
        )
      }
    </>
  )
}

export default memo(HelpLine)
