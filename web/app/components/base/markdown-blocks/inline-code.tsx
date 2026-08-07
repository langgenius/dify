import type { ComponentProps } from 'react'
import type { ExtraProps } from 'streamdown'
import { memo } from 'react'

type InlineCodeProps = ComponentProps<'code'> & ExtraProps

function InlineCode({ node: _node, ...props }: InlineCodeProps) {
  return <code {...props} />
}

function areInlineCodePropsEqual(previousProps: InlineCodeProps, nextProps: InlineCodeProps) {
  const previousKeys = Object.keys(previousProps).filter((key) => key !== 'node') as Array<
    keyof InlineCodeProps
  >
  const nextKeys = Object.keys(nextProps).filter((key) => key !== 'node')

  return (
    previousKeys.length === nextKeys.length &&
    previousKeys.every((key) => Object.is(previousProps[key], nextProps[key]))
  )
}

export default memo(InlineCode, areInlineCodePropsEqual)
