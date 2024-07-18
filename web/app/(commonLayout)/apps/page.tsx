import Apps from './Apps'

const AppList = async () => {
  return (
    <div className='relative flex flex-col overflow-y-auto bg-gray-100 shrink-0 h-0 grow'>
      <Apps />
    </div >
  )
}

export default AppList
