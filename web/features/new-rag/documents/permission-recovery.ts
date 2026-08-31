export const DOCUMENT_PERMISSION_DENIED = 1
export const TASK_PERMISSION_DENIED = 2
export const SOURCE_PERMISSION_DENIED = 4

export function recoveryQueryMaskForPermissionDenials(permissionDenialMask: number) {
  let recoveryQueryMask = 0
  if (permissionDenialMask & DOCUMENT_PERMISSION_DENIED)
    recoveryQueryMask |= TASK_PERMISSION_DENIED | SOURCE_PERMISSION_DENIED
  if (permissionDenialMask & TASK_PERMISSION_DENIED) recoveryQueryMask |= SOURCE_PERMISSION_DENIED
  if (permissionDenialMask & SOURCE_PERMISSION_DENIED) recoveryQueryMask |= TASK_PERMISSION_DENIED
  return recoveryQueryMask & ~permissionDenialMask
}
