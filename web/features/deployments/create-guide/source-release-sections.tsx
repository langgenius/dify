'use client'

import type { ReactNode } from 'react'
import type { UnsupportedDslNode } from '../error'
import type { GuideMethod } from './types'
import type { App } from '@/types/app'
import { UnsupportedDslNodesAlert } from '../components/unsupported-dsl-nodes-alert'
import { DslStep } from './dsl-step'
import { MethodStep } from './method-step'
import { ReleaseStep } from './release-step'
import { SourceStep } from './source-step'

export type CreationSectionsProps = {
  children?: ReactNode
  defaultedReleaseName: string
  instanceDescription: string
  instanceName: string
  instanceNameError?: string
  method?: GuideMethod
  onInstanceDescriptionChange: (value: string) => void
  onInstanceNameChange: (value: string) => void
  onReleaseDescriptionChange: (value: string) => void
  onReleaseNameChange: (value: string) => void
  onSearchTextChange: (value: string) => void
  onSelectMethod: (method: GuideMethod) => void
  onSelectSourceApp: (app: App) => void
  onDslFileChange: (file?: File) => void
  releaseDescription: string
  releaseName: string
  selectedApp?: App
  sourceApps: App[]
  sourceAppsLoading: boolean
  sourceName?: string
  sourceSearchText: string
  stage: 'source' | 'release'
  unsupportedDslNodes: UnsupportedDslNode[]
  dslFile?: File
  isReadingDsl: boolean
  dslReadError: boolean
  dslUnsupportedMode: boolean
}

export function CreationSections({
  children,
  defaultedReleaseName,
  instanceDescription,
  instanceName,
  instanceNameError,
  method,
  onInstanceDescriptionChange,
  onInstanceNameChange,
  onReleaseDescriptionChange,
  onReleaseNameChange,
  onSearchTextChange,
  onSelectMethod,
  onSelectSourceApp,
  onDslFileChange,
  releaseDescription,
  releaseName,
  selectedApp,
  sourceApps,
  sourceAppsLoading,
  sourceName,
  sourceSearchText,
  stage,
  unsupportedDslNodes,
  dslFile,
  isReadingDsl,
  dslReadError,
  dslUnsupportedMode,
}: CreationSectionsProps) {
  return (
    <div className="flex h-full min-h-0 flex-col gap-7 pb-4">
      {stage === 'source' && (
        <div className="flex min-h-0 flex-1 flex-col gap-4">
          <MethodStep method={method} onSelect={onSelectMethod} />
          {method === 'bindApp' && (
            <SourceStep
              apps={sourceApps}
              selectedApp={selectedApp}
              searchText={sourceSearchText}
              isLoading={sourceAppsLoading}
              onSearchTextChange={onSearchTextChange}
              onSelectApp={onSelectSourceApp}
            />
          )}
          {method === 'importDsl' && (
            <DslStep
              dslFile={dslFile}
              isReadingDsl={isReadingDsl}
              readError={dslReadError}
              unsupportedMode={dslUnsupportedMode}
              onDslFileChange={onDslFileChange}
            />
          )}
          <UnsupportedDslNodesAlert nodes={unsupportedDslNodes} />
        </div>
      )}
      {stage === 'release' && method && (
        <ReleaseStep
          instanceName={instanceName}
          instanceDescription={instanceDescription}
          releaseName={releaseName}
          releaseDescription={releaseDescription}
          instanceNamePlaceholder={sourceName}
          instanceNameError={instanceNameError}
          releaseNamePlaceholder={defaultedReleaseName}
          onInstanceNameChange={onInstanceNameChange}
          onInstanceDescriptionChange={onInstanceDescriptionChange}
          onReleaseNameChange={onReleaseNameChange}
          onReleaseDescriptionChange={onReleaseDescriptionChange}
        />
      )}
      {children}
    </div>
  )
}
