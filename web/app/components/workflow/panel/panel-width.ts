export const getPreviewPanelMaxWidth = (
  workflowCanvasWidth: number | undefined,
  hasSelectedNode: boolean,
  fallback = 1024,
) => {
  if (!workflowCanvasWidth) return fallback

  // Keep the canvas visible and allow an open node panel to shrink to its minimum.
  const reservedWidth = 400 + (hasSelectedNode ? 400 : 0)
  return Math.max(400, workflowCanvasWidth - reservedWidth)
}
