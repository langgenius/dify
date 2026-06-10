import {
  dslLocalAtoms,
} from './dsl-atoms'
import {
  releaseLocalAtoms,
} from './release-atoms'
import {
  sourceLocalAtoms,
} from './source-atoms'
import {
  targetLocalAtoms,
} from './target-atoms'
import {
  unsupportedDslLocalAtoms,
} from './unsupported-dsl-atoms'
import {
  workflowLocalAtoms,
} from './workflow-atoms'

export const createDeploymentGuideLocalAtoms = [
  ...workflowLocalAtoms,
  ...sourceLocalAtoms,
  ...dslLocalAtoms,
  ...releaseLocalAtoms,
  ...targetLocalAtoms,
  ...unsupportedDslLocalAtoms,
] as const
