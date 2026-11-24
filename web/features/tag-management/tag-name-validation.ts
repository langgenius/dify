import type { TFunction } from 'i18next'
import { ORPCError } from '@orpc/client'
import { getHttpErrorStatus } from '@/service/http-error'
import { isTagNameTooLongError, MAX_TAG_NAME_LENGTH } from './tag-name-length'

export function getTagNameValidationMessage(
  error: unknown,
  t: TFunction<['common']>,
  operation: 'create' | 'rename',
) {
  if (
    error instanceof ORPCError &&
    error.status === 400 &&
    error.code === 'invalid_param' &&
    error.message === 'Tag name already exists'
  ) {
    return t(($) => $['tag.nameAlreadyExists'])
  }
  if (isTagNameTooLongError(error))
    return t(($) => $['tag.nameTooLong'], { max: MAX_TAG_NAME_LENGTH })
  if (getHttpErrorStatus(error) === 422) {
    return operation === 'create'
      ? t(($) => $['tag.failed'])
      : t(($) => $['actionMsg.modifiedUnsuccessfully'])
  }
}
