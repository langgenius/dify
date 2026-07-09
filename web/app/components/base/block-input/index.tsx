'use client'

// regex to match the {{}} and replace it with a span
const regex = /\{\{([^}]+)\}\}/g

export const getInputKeys = (value: string) => {
  const keys = value.match(regex)?.map((item) => {
    return item.replace('{{', '').replace('}}', '')
  }) || []
  const keyObj: Record<string, boolean> = {}
  // remove duplicate keys
  const res: string[] = []
  keys.forEach((key) => {
    if (keyObj[key])
      return

    keyObj[key] = true
    res.push(key)
  })
  return res
}
