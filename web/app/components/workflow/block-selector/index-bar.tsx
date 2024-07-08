import { pinyin } from 'pinyin-pro'

export const groupItems = (items, getFirstChar) => {
  const groups = items.reduce((acc, item) => {
    const firstChar = getFirstChar(item)
    if (!firstChar || firstChar.length === 0)
      return acc

    let letter

    // transform Chinese to pinyin
    if (/[\u4E00-\u9FA5]/.test(firstChar))
      letter = pinyin(firstChar, { pattern: 'first', toneType: 'none' })[0].toUpperCase()
    else
      letter = firstChar.toUpperCase()

    if (!/[A-Z]/.test(letter))
      letter = '#'

    if (!acc[letter])
      acc[letter] = []

    acc[letter].push(item)
    return acc
  }, {})

  const letters = Object.keys(groups).sort()
  // move '#' to the end
  const hashIndex = letters.indexOf('#')
  if (hashIndex !== -1) {
    letters.splice(hashIndex, 1)
    letters.push('#')
  }
  return { letters, groups }
}

const IndexBar = ({ letters, itemRefs }) => {
  const handleIndexClick = (letter) => {
    const element = itemRefs.current[letter]
    if (element)
      element.scrollIntoView({ behavior: 'smooth' })
  }
  return (
    <div className="index-bar fixed right-4 top-36 flex flex-col items-center text-xs font-medium text-gray-500">
      {letters.map(letter => (
        <div className="hover:text-gray-900 cursor-pointer" key={letter} onClick={() => handleIndexClick(letter)}>
          {letter}
        </div>
      ))}
    </div>
  )
}

export default IndexBar
