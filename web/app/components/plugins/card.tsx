const Card = () => {
  return (
    <div className='border-[0.5px] border-components-panel-border bg-components-panel-on-panel-item-bg rounded-xl shadow-xs'>
      <div className='flex items-center p-4 py-2'>
        <div className='mr-3 w-10 h-10 rounded-[10px] border-[0.5px] border-components-panel-border-subtle bg-background-default-dodge'></div>
        <div>
          <div className='flex items-center mb-0.5 system-md-semibold text-text-secondary'>
            Notion Page Search
          </div>
          <div className='flex items-center system-xs-regular text-text-tertiary'>
            Notion
            <div className='mx-0.5 text-text-quaternary'>/</div>
            notion-page-search
          </div>
        </div>
      </div>
      <div className='px-4 pt-1 pb-2 system-xs-regular text-text-tertiary'>
        Search Notion pages and open visited ones faster. No admin access required.
      </div>
    </div>
  )
}

export default Card
