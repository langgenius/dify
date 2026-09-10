export type ToolsContentInset = 'default' | 'compact'

export const toolsContentFrameClassNames: Record<ToolsContentInset, string> = {
  default: 'w-full',
  compact: 'mx-auto box-border w-full max-w-[1600px]',
}

export const toolsUnifiedContentFrameClassName = 'mx-auto box-border w-full max-w-[1600px]'

export const toolsContentInsetClassNames: Record<ToolsContentInset, string> = {
  default: 'px-12',
  compact: 'px-6',
}
