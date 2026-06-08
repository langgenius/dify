'use client'

import { useState } from 'react'
import { availableInstanceName } from './instance-name'

export function useDeploymentGuideReleaseFields({
  defaultedReleaseName,
  existingInstanceNames,
  onFieldChange,
  sourceName,
}: {
  defaultedReleaseName: string
  existingInstanceNames: readonly string[]
  onFieldChange: () => void
  sourceName: string
}) {
  const [instanceName, setInstanceName] = useState('')
  const [instanceDescription, setInstanceDescription] = useState('')
  const [releaseName, setReleaseName] = useState('')
  const [releaseDescription, setReleaseDescription] = useState('')
  const submittedInstanceName = instanceName.trim()
  const submittedReleaseName = releaseName.trim()
  const submittedReleaseDescription = releaseDescription.trim()

  function applyReleaseDefaults() {
    const nextInstanceName = sourceName.trim()

    if (!instanceName.trim() && nextInstanceName)
      setInstanceName(availableInstanceName(nextInstanceName, existingInstanceNames))
    if (!releaseName.trim())
      setReleaseName(defaultedReleaseName)
  }

  function handleInstanceDescriptionChange(value: string) {
    setInstanceDescription(value)
    onFieldChange()
  }

  function handleInstanceNameChange(value: string) {
    setInstanceName(value)
    onFieldChange()
  }

  function handleReleaseDescriptionChange(value: string) {
    setReleaseDescription(value)
    onFieldChange()
  }

  function handleReleaseNameChange(value: string) {
    setReleaseName(value)
    onFieldChange()
  }

  return {
    applyReleaseDefaults,
    handleInstanceDescriptionChange,
    handleInstanceNameChange,
    handleReleaseDescriptionChange,
    handleReleaseNameChange,
    instanceDescription,
    instanceName,
    releaseDescription,
    releaseName,
    submittedInstanceName,
    submittedReleaseDescription,
    submittedReleaseName,
  }
}
