import type { TFunction } from 'i18next'
import { getHttpErrorStatus } from '@/service/http-error'
import { isTagNameTooLongError, MAX_TAG_NAME_LENGTH } from './tag-name-length'

export function getTagNameValidationMessage(
  error: unknown,
  t: TFunction<['common']>,
  operation: 'create' | 'rename',
) {
  if (isTagNameTooLongError(error))
    return t(($) => $['tag.nameTooLong'], { max: MAX_TAG_NAME_LENGTH })
  if (getHttpErrorStatus(error) === 422) {
    return operation === 'create'
      ? t(($) => $['tag.failed'])
      : t(($) => $['actionMsg.modifiedUnsuccessfully'])
  }
}
