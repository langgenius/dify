const ApiServer = () => {
  return (
    <div className='flex items-center'>
      <div className='flex items-center pl-1.5 pr-1 h-8 bg-white/80 border-[0.5px] border-white rounded'>
        <div className='mr-0.5 px-1.5 h-5 border border-gray-200 text-[11px] text-gray-500 rounded-md'>API Server</div>
        <div className='px-1 w-[169px] text-[13px] font-medium text-gray-800'>https://api.langgenius.ai/v1</div>
        <div className='mx-1 w-[1px] h-[14px] bg-gray-200'></div>
        <div className='flex justify-center items-center w-6 h-6'></div>
      </div>
    </div>
  )
}

export default ApiServer
