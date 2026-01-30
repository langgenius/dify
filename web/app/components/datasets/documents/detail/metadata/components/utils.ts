export const map2Options = (map: { [key: string]: string }) => {
  return Object.keys(map).map(key => ({ value: key, name: map[key] }))
}
