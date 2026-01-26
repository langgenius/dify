export const AGENT_CONTEXT_VAR_PATTERN = /\{\{@[^.@#]+\.context@\}\}/g
const AGENT_CONTEXT_VAR_PREFIX = '{{@'
const AGENT_CONTEXT_VAR_SUFFIX = '.context@}}'

export const getAgentNodeIdFromContextVar = (placeholder: string): string => {
  if (!placeholder.startsWith(AGENT_CONTEXT_VAR_PREFIX) || !placeholder.endsWith(AGENT_CONTEXT_VAR_SUFFIX))
    return ''
  return placeholder.slice(AGENT_CONTEXT_VAR_PREFIX.length, -AGENT_CONTEXT_VAR_SUFFIX.length)
}
