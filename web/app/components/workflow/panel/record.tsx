import Run from '../run'

const Record = () => {
  return (
    <div className='flex flex-col w-[400px] h-full rounded-2xl border-[0.5px] border-gray-200 shadow-xl bg-white'>
      <div className='p-4 pb-1 text-base font-semibold text-gray-900'>
        Test Run#5
      </div>
      <Run activeTab='RESULT' appId='' />
    </div>
  )
}

export default Record
