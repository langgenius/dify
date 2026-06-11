'use client'

import { useAtomValue } from 'jotai'
import {
  existingInstanceNamesFromQueryData,
  instanceNameConflictFromQueryData,
  useExistingInstanceNamesQuery,
  useInstanceNameConflictQuery,
} from '../queries/source'
import { submittedReleaseFieldsAtom } from '../state/release-atoms'

function hasReleaseInstanceNameConflict({
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

export function useReleaseInstanceNameConflictQuery() {
  const appInstancesQuery = useExistingInstanceNamesQuery()
  const existingInstanceNames = existingInstanceNamesFromQueryData(appInstancesQuery.data)
  const submittedInstanceName = useAtomValue(submittedReleaseFieldsAtom).submittedInstanceName
  const instanceNameConflictQuery = useInstanceNameConflictQuery({
    enabled: Boolean(submittedInstanceName),
    submittedInstanceName,
  })
  const remoteInstanceNameConflict = instanceNameConflictFromQueryData(instanceNameConflictQuery.data, submittedInstanceName)
  const hasInstanceNameConflict = hasReleaseInstanceNameConflict({
    existingInstanceNames,
    remoteInstanceNameConflict,
    submittedInstanceName,
  })

  return { hasInstanceNameConflict, instanceNameConflictQuery, submittedInstanceName }
}
