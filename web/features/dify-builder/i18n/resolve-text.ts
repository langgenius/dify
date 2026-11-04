import type {
  BuilderCopy,
  BuilderTextParts,
} from '@dify/contracts/api/console/dify-builder/types.gen'
import type { TFunction } from 'i18next'
import { keyFromSelector } from 'i18next'
import { builderSceneKeys } from './scene-keys'

export type BuilderText = string | BuilderCopy | BuilderTextParts
export const resolveBuilderText = (
  text: BuilderText | null | undefined,
  t: TFunction<['difyBuilder']>,
): string => {
  if (text == null) return ''
  if (typeof text === 'string') return text
  if ('parts' in text) return text.parts.map((part) => resolveBuilderText(part, t)).join('')
  return t(
    keyFromSelector<['difyBuilder']>(($) => $[builderSceneKeys[text.id]]),
    { ns: 'difyBuilder', ...text.params },
  )
}
