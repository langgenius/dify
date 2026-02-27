/**
 * Node navigation utilities for workflow
 * This module provides functions for node selection, focusing and scrolling in workflow
 */

/**
 * Interface for node selection event detail
 */
export type NodeSelectionDetail = {
  nodeId: string
  focus?: boolean
}

/**
 * Select a node in the workflow
 * @param nodeId - The ID of the node to select
 * @param focus - Whether to focus/scroll to the node
 */
export function selectWorkflowNode(nodeId: string, focus = false): void {
  // Create and dispatch a custom event for node selection
  const event = new CustomEvent('workflow:select-node', {
    detail: {
      nodeId,
      focus,
    },
  })
  document.dispatchEvent(event)
}

/**
 * Scroll to a specific node in the workflow
 * @param nodeId - The ID of the node to scroll to
 */
export function scrollToWorkflowNode(nodeId: string): void {
  // Create and dispatch a custom event for scrolling to node
  const event = new CustomEvent('workflow:scroll-to-node', {
    detail: { nodeId },
  })
  document.dispatchEvent(event)
}

/**
 * Setup node selection event listener
 * @param handleNodeSelect - Function to handle node selection
 * @returns Cleanup function
 */
export function setupNodeSelectionListener(
  handleNodeSelect: (nodeId: string) => void,
): () => void {
  // Event handler for node selection
  const handleNodeSelection = (event: CustomEvent<NodeSelectionDetail>) => {
    const { nodeId, focus } = event.detail
    if (nodeId) {
      // Select the node
      handleNodeSelect(nodeId)

      // If focus is requested, scroll to the node
      if (focus) {
        // Use a small timeout to ensure node selection happens first
        setTimeout(() => {
          scrollToWorkflowNode(nodeId)
        }, 100)
      }
    }
  }

  // Add event listener
  document.addEventListener(
    'workflow:select-node',
    handleNodeSelection as EventListener,
  )

  // Return cleanup function
  return () => {
    document.removeEventListener(
      'workflow:select-node',
      handleNodeSelection as EventListener,
    )
  }
}

/**
 * Setup scroll to node event listener with ReactFlow
 * @param nodes - The workflow nodes
 * @param reactflow - The ReactFlow instance
 * @returns Cleanup function
 */
export function setupScrollToNodeListener(
  nodes: any[],
  reactflow: any,
): () => void {
  // Event handler for scrolling to node
  const handleScrollToNode = (event: CustomEvent<NodeSelectionDetail>) => {
    const { nodeId } = event.detail
    if (nodeId) {
      // Find the target node
      const node = nodes.find(n => n.id === nodeId)
      if (node) {
        // Use ReactFlow's fitView API to scroll to the node
        const nodePosition = { x: node.position.x, y: node.position.y }

        // Calculate position to place node in top-left area
        // Move the center point right and down to show node in top-left
        const targetX = nodePosition.x + window.innerWidth * 0.25
        const targetY = nodePosition.y + window.innerHeight * 0.25

        reactflow.setCenter(targetX, targetY, { zoom: 1, duration: 800 })
      }
    }
  }

  // Add event listener
  document.addEventListener(
    'workflow:scroll-to-node',
    handleScrollToNode as EventListener,
  )

  // Return cleanup function
  return () => {
    document.removeEventListener(
      'workflow:scroll-to-node',
      handleScrollToNode as EventListener,
    )
  }
}
