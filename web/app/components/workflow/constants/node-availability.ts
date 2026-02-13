import { BlockEnum } from '@/app/components/workflow/types'

export enum NodeSelectorScene {
  Workflow = 'workflow',
  Chatflow = 'chatflow',
  RagPipeline = 'rag-pipeline',
  Subgraph = 'subgraph',
}

export enum NodeSelectorSandboxMode {
  Enabled = 'enabled',
  Disabled = 'disabled',
  Unsupported = 'unsupported',
}

export const NODE_SELECTOR_SCENE_SUPPORTS_SANDBOX: Record<NodeSelectorScene, boolean> = {
  [NodeSelectorScene.Workflow]: true,
  [NodeSelectorScene.Chatflow]: true,
  [NodeSelectorScene.RagPipeline]: false,
  [NodeSelectorScene.Subgraph]: true,
}

type NodeAvailabilityRule = {
  sandboxOnly?: boolean
  hiddenWhenSandboxEnabled?: boolean
  hiddenInScenes?: NodeSelectorScene[]
}

export const NODE_SELECTOR_AVAILABILITY_RULES: Partial<Record<BlockEnum, NodeAvailabilityRule>> = {
  [BlockEnum.Command]: { sandboxOnly: true },
  [BlockEnum.FileUpload]: { sandboxOnly: true },
  [BlockEnum.Agent]: { hiddenWhenSandboxEnabled: true },
  [BlockEnum.HumanInput]: { hiddenInScenes: [NodeSelectorScene.RagPipeline] },
}

export type NodeSelectorAvailabilityContext = {
  scene: NodeSelectorScene
  sandboxMode: NodeSelectorSandboxMode
}

type BuildNodeSelectorAvailabilityContextProps = {
  scene: NodeSelectorScene
  isSandboxRuntime?: boolean
  isSandboxFeatureEnabled?: boolean
  supportsSandbox?: boolean
}

const resolveSandboxMode = ({
  scene,
  isSandboxRuntime = false,
  isSandboxFeatureEnabled = false,
  supportsSandbox = NODE_SELECTOR_SCENE_SUPPORTS_SANDBOX[scene],
}: BuildNodeSelectorAvailabilityContextProps): NodeSelectorSandboxMode => {
  if (!supportsSandbox)
    return NodeSelectorSandboxMode.Unsupported

  return (isSandboxRuntime || isSandboxFeatureEnabled)
    ? NodeSelectorSandboxMode.Enabled
    : NodeSelectorSandboxMode.Disabled
}

export const buildNodeSelectorAvailabilityContext = ({
  scene,
  isSandboxRuntime,
  isSandboxFeatureEnabled,
  supportsSandbox,
}: BuildNodeSelectorAvailabilityContextProps): NodeSelectorAvailabilityContext => {
  return {
    scene,
    sandboxMode: resolveSandboxMode({
      scene,
      isSandboxRuntime,
      isSandboxFeatureEnabled,
      supportsSandbox,
    }),
  }
}

export const isNodeAvailableInSelector = (
  nodeType: BlockEnum,
  { scene, sandboxMode }: NodeSelectorAvailabilityContext,
) => {
  const rule = NODE_SELECTOR_AVAILABILITY_RULES[nodeType]
  if (!rule)
    return true

  const sandboxEnabled = sandboxMode === NodeSelectorSandboxMode.Enabled
  if (rule.sandboxOnly && !sandboxEnabled)
    return false

  if (rule.hiddenWhenSandboxEnabled && sandboxEnabled)
    return false

  if (rule.hiddenInScenes?.includes(scene))
    return false

  return true
}

type NodeLike = {
  metaData: {
    type: BlockEnum
  }
}

export const filterNodesForSelector = <T extends NodeLike>(
  nodes: T[],
  context: NodeSelectorAvailabilityContext,
) => {
  const filteredNodes = nodes.filter(node => isNodeAvailableInSelector(node.metaData.type, context))
  if (filteredNodes.length === nodes.length)
    return nodes

  return filteredNodes
}
