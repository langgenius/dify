export type PluginPageContentInset = 'default' | 'compact'

export const pluginPageContentFrameClassNames: Record<PluginPageContentInset, string> = {
  default: 'w-full',
  compact: 'mx-auto box-border w-full max-w-[1600px]',
}

export const pluginPageContentInsetClassNames: Record<PluginPageContentInset, string> = {
  default: 'px-12',
  compact: 'px-6',
}
