import type { Edge, Node } from '../types'
import {
  useEdges,
  useNodes,
  useReactFlow,
  useStoreApi,
} from '@xyflow/react'

export const useWorkflowReactFlow = <T = Record<string, unknown>>() => useReactFlow<Node<T>, Edge>()

export const useWorkflowStoreApi = <T = Record<string, unknown>>() => useStoreApi<Node<T>, Edge>()

export const useWorkflowFlowNodes = <T = Record<string, unknown>>() => useNodes<Node<T>>()

export const useWorkflowFlowEdges = () => useEdges<Edge>()
