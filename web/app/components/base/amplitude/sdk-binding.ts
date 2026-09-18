type AmplitudeSdk = typeof import('@amplitude/analytics-browser')

let boundAmplitudeSdk: AmplitudeSdk | null = null

export const bindAmplitudeSdk = (sdk: AmplitudeSdk) => {
  boundAmplitudeSdk = sdk
}

export const getBoundAmplitudeSdk = () => boundAmplitudeSdk

export const clearBoundAmplitudeSdk = () => {
  boundAmplitudeSdk = null
}
