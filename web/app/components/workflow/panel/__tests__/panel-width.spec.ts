import { getPreviewPanelMaxWidth } from '../panel-width'

describe('getPreviewPanelMaxWidth', () => {
  it.each([undefined, 0])(
    'uses the caller fallback before canvas width is measured (%s)',
    (canvasWidth) => {
      expect(getPreviewPanelMaxWidth(canvasWidth, false)).toBe(1024)
      expect(getPreviewPanelMaxWidth(canvasWidth, true, 720)).toBe(720)
    },
  )

  it.each([
    { hasSelectedNode: false, expected: 1000 },
    { hasSelectedNode: true, expected: 600 },
  ])(
    'reserves space for the canvas and an open node panel (selected: $hasSelectedNode)',
    ({ hasSelectedNode, expected }) => {
      expect(getPreviewPanelMaxWidth(1400, hasSelectedNode)).toBe(expected)
      expect(getPreviewPanelMaxWidth(1400, hasSelectedNode, 720)).toBe(expected)
    },
  )

  it.each([
    { canvasWidth: 600, hasSelectedNode: false, expected: 400 },
    { canvasWidth: 800, hasSelectedNode: false, expected: 400 },
    { canvasWidth: 801, hasSelectedNode: false, expected: 401 },
    { canvasWidth: 1000, hasSelectedNode: true, expected: 400 },
    { canvasWidth: 1200, hasSelectedNode: true, expected: 400 },
    { canvasWidth: 1201, hasSelectedNode: true, expected: 401 },
  ])(
    'keeps the preview usable on a $canvasWidth px canvas (selected: $hasSelectedNode)',
    ({ canvasWidth, hasSelectedNode, expected }) => {
      expect(getPreviewPanelMaxWidth(canvasWidth, hasSelectedNode)).toBe(expected)
    },
  )
})
