type ShortcutsNameProps = {
  keys: string[]
}
const ShortcutsName = ({
  keys,
}: ShortcutsNameProps) => {
  return (
    <div className='flex items-center gap-0.5 h-4 text-xs text-gray-400'>
      {
        keys.map(key => (
          <div
            key={key}
          >
            {key}
          </div>
        ))
      }
    </div>
  )
}

export default ShortcutsName
