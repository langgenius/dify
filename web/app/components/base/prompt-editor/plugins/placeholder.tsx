const Placeholder = () => {
  return (
    <div className='absolute top-0 left-0 text-sm text-gray-300 select-none pointer-events-none'>
      {'Write your prompt here, type ‘{{variable_name}}’ to insert variable'}
    </div>
  )
}

export default Placeholder
