import { Theme } from '@/types/app'

/**
 * Chart colors for the knowledge graph.
 *
 * A node-link diagram can place any two nodes side by side, so these are held to
 * the all-pairs colorblind-separation gate rather than the adjacent-pair one.
 * Both pairs below pass every check in their own mode (worst all-pairs CVD
 * ΔE 24.7 light / 26.8 dark, normal-vision 33.6 / 31.8).
 *
 * Entity type is deliberately NOT encoded in color: there are ten types, far past
 * the three that clear the all-pairs gate, and ten hues in a node-link diagram is
 * unreadable regardless. Type is carried by the node tooltip and the entity list
 * instead, and color is reserved for the one distinction that must survive a
 * glance — which node the view is focused on.
 */
type GraphChartColors = {
  node: string
  focusedNode: string
  edge: string
  label: string
  mutedLabel: string
  surface: string
}

const LIGHT: GraphChartColors = {
  node: '#2a78d6',
  focusedNode: '#eb6834',
  edge: '#d0d0cc',
  label: '#0b0b0b',
  mutedLabel: '#52514e',
  surface: '#fcfcfb',
}

const DARK: GraphChartColors = {
  node: '#3987e5',
  focusedNode: '#d95926',
  edge: '#4a4a46',
  label: '#ffffff',
  mutedLabel: '#c3c2b7',
  surface: '#1a1a19',
}

export const getGraphChartColors = (theme: Theme | undefined): GraphChartColors =>
  theme === Theme.dark ? DARK : LIGHT

/** Node radius scales with how many chunks mention the entity. */
export const MIN_NODE_SIZE = 12
export const MAX_NODE_SIZE = 42

export const getNodeSize = (frequency: number, maxFrequency: number) => {
  if (maxFrequency <= 1) return MIN_NODE_SIZE
  // sqrt keeps area, not radius, proportional to frequency
  const ratio = Math.sqrt(Math.max(frequency, 1) / maxFrequency)
  return MIN_NODE_SIZE + ratio * (MAX_NODE_SIZE - MIN_NODE_SIZE)
}
