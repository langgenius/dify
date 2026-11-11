export type PublisherEnvironment = {
  id: string
  name: string
}

export type EnvironmentTabMeasurements = {
  availableWidth: number
  builtInWidth: number
  environmentTextWidths: Record<string, number>
  moreEnvironmentsWidth: number
  moreWidth: number
}

export type PublisherEnvironmentTabsProps = {
  environments: readonly PublisherEnvironment[]
  joinedEnvironmentIds: readonly string[]
  selectedEnvironmentId: string
  onAddEnvironment: (environmentId: string) => void
  onSelectEnvironment: (environmentId: string) => void
}
