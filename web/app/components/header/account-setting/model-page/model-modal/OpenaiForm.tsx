import KeyInput from '../../key-validator/KeyInput'

const OpenaiForm = () => {
  return (
    <div>
      <div className=''>API Key</div>
      <KeyInput
        name='API Key'
        placeholder={'xx'}
        value={''}
        onChange={() => {}}
        onFocus={() => {}}
        validating={false}
        validatedStatusState={{}}
      />
    </div>
  )
}

export default OpenaiForm
