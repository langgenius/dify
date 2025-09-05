export const genActionId = () => {
  return `a${Date.now().toString(36)}${Math.floor(Math.random() * 36).toString(36)}`
}

export const isOutput = (valueSelector: string[]) => {
  return valueSelector[0] === '$output'
}
