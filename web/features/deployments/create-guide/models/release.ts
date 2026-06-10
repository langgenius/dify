export function isInitialReleaseReady({
  hasInstanceNameConflict,
  isCheckingInstanceNameConflict,
  isSourceReady,
  submittedInstanceName,
  submittedReleaseName,
}: {
  hasInstanceNameConflict: boolean
  isCheckingInstanceNameConflict: boolean
  isSourceReady: boolean
  submittedInstanceName: string
  submittedReleaseName: string
}) {
  return Boolean(
    isSourceReady
    && submittedInstanceName
    && submittedReleaseName
    && !hasInstanceNameConflict
    && !isCheckingInstanceNameConflict,
  )
}

export function hasReleaseInstanceNameConflict({
  existingInstanceNames,
  remoteInstanceNameConflict,
  submittedInstanceName,
}: {
  existingInstanceNames: readonly string[]
  remoteInstanceNameConflict: boolean | undefined
  submittedInstanceName: string
}) {
  return Boolean(
    submittedInstanceName
    && (
      existingInstanceNames.includes(submittedInstanceName)
      || remoteInstanceNameConflict
    ),
  )
}
