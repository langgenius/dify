import type { ComponentType, ReactNode } from 'react'
import type { ReactFlowInstance } from 'reactflow'
import type { CommonNodeType } from '../../types'
import { createElement, useLayoutEffect } from 'react'
import { useNodes, useReactFlow } from 'reactflow'
import { consoleQuery } from '@/service/console'
import { createConsoleQueryWrapper } from '@/test/console/query-data'
import { seedToolProviders } from '@/test/console/tool-providers'
import { createNode } from '../../__tests__/fixtures'
import { renderWorkflowFlowComponent } from '../../__tests__/workflow-test-env'

type Options = Pick<
  NonNullable<Parameters<typeof renderWorkflowFlowComponent>[1]>,
  'resource' | 'nodes' | 'edges' | 'initialStoreState' | 'queryClient' | 'hooksStoreProps'
> & { nodeId?: string; wrapper?: ComponentType<{ children: ReactNode }> }

// Subscribe to the real graph so every edit is fed back into the next configuration render.
export const renderNodeConfig = <T extends CommonNodeType, R>(
  useConfig: (id: string, data: T) => R,
  payload: T,
  {
    nodeId = 'node',
    queryClient = createConsoleQueryWrapper().queryClient,
    nodes,
    wrapper: ExtraWrapper,
    ...options
  }: Options = {},
) => {
  seedToolProviders(queryClient, {
    builtInTools: [],
    customTools: [],
    workflowTools: [],
    mcpTools: [],
  })
  queryClient.setQueryData(consoleQuery.spec.schemaDefinitions.get.queryKey(), [])
  let current: { config: R; flow: ReactFlowInstance }
  const Probe = ({ data }: { data: T }) => {
    const config = useConfig(nodeId, data)
    const flow = useReactFlow()
    useLayoutEffect(() => {
      current = { config, flow }
    })
    return null
  }
  const GraphReady = () => {
    const node = useNodes<T>().find((node) => node.id === nodeId)
    // Production opens configuration only after its graph node exists.
    return node ? createElement(Probe, { data: node.data }) : null
  }
  const rendered = renderWorkflowFlowComponent(
    ExtraWrapper
      ? createElement(ExtraWrapper, null, createElement(GraphReady))
      : createElement(GraphReady),
    {
      ...options,
      queryClient,
      nodes: nodes ?? [createNode({ id: nodeId, data: payload })],
    },
  )
  return {
    ...rendered,
    result: {
      get current() {
        return current
      },
    },
  }
}
