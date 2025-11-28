const translation = {
  subscription: {
    title: 'सदस्यताएँ',
    listNum: '{{num}} सब्सक्रिप्शन्स',
    empty: {
      title: 'कोई सदस्यता नहीं',
      button: 'नई सब्सक्रिप्शन',
    },
    createButton: {
      oauth: 'OAuth के साथ नई सदस्यता',
      apiKey: 'एपीआई कुंजी के साथ नया सब्सक्रिप्शन',
      manual: 'नई सदस्यता बनाने के लिए URL चिपकाएँ',
    },
    createSuccess: 'सब्सक्रिप्शन सफलतापूर्वक बनाया गया',
    createFailed: 'सब्सक्रिप्शन बनाने में असफल',
    maxCount: 'अधिकतम {{num}} सदस्यताएँ',
    selectPlaceholder: 'सदस्यता चुनें',
    noSubscriptionSelected: 'कोई सदस्यता नहीं चुनी गई',
    subscriptionRemoved: 'सदस्यता हटा दी गई',
    list: {
      title: 'सदस्यताएँ',
      addButton: 'जोड़ें',
      tip: 'सब्सक्रिप्शन के माध्यम से इवेंट प्राप्त करें',
      item: {
        enabled: 'सक्रिय',
        disabled: 'विकलांग',
        credentialType: {
          api_key: 'एपीआई कुंजी',
          oauth2: 'OAuth',
          unauthorized: 'मैनुअल',
        },
        actions: {
          delete: 'हटाएँ',
          deleteConfirm: {
            title: 'क्या आप {{name}} को हटा देना चाहते हैं?',
            success: 'सदस्यता {{name}} सफलतापूर्वक हटाई गई',
            error: 'सदस्यता {{name}} हटाने में असफल',
            content: 'एक बार हटा दी जाने के बाद, इस सदस्यता को पुनर्प्राप्त नहीं किया जा सकता। कृपया पुष्टि करें।',
            contentWithApps: 'वर्तमान सदस्यता का संदर्भ {{count}} अनुप्रयोगों द्वारा लिया गया है। इसे हटाने से कॉन्फ़िगर किए गए अनुप्रयोग सदस्यता घटनाओं को प्राप्त करना बंद कर देंगे।',
            confirm: 'हटाना पुष्टि करें',
            cancel: 'रद्द करें',
            confirmInputWarning: 'कृपया पुष्टि करने के लिए सही नाम दर्ज करें।',
            confirmInputPlaceholder: 'पुष्टि करने के लिए "{{name}}" दर्ज करें।',
            confirmInputTip: 'कृपया पुष्टि करने के लिए “{{name}}” दर्ज करें।',
          },
        },
        status: {
          active: 'सक्रिय',
          inactive: 'निष्क्रिय',
        },
        usedByNum: '{{num}} वर्कफ़्लो द्वारा उपयोग किया गया',
        noUsed: 'कोई वर्कफ़्लो उपयोग नहीं किया गया',
      },
    },
    addType: {
      title: 'सदस्यता जोड़ें',
      description: 'निर्धारित करने के लिए चुनें कि आप अपनी ट्रिगर सदस्यता कैसे बनाना चाहते हैं',
      options: {
        apikey: {
          title: 'एपीआई कुंजी के साथ बनाएं',
          description: 'API क्रेडेंशियल का उपयोग करके स्वचालित रूप से सब्सक्रिप्शन बनाएं',
        },
        oauth: {
          title: 'OAuth के साथ बनाएं',
          description: 'सदस्यता बनाने के लिए तृतीय-पक्ष प्लेटफ़ॉर्म के साथ प्राधिकृत करें',
          clientSettings: 'OAuth क्लाइंट सेटिंग्स',
          clientTitle: 'OAuth क्लाइंट',
          default: 'डिफ़ॉल्ट',
          custom: 'कस्टम',
        },
        manual: {
          title: 'मैनुअल सेटअप',
          description: 'नई सदस्यता बनाने के लिए URL चिपकाएँ',
          tip: 'थर्ड-पार्टी प्लेटफ़ॉर्म पर URL मैन्युअली कॉन्फ़िगर करें',
        },
      },
    },
  },
  modal: {
    steps: {
      verify: 'सत्यापित करें',
      configuration: 'कॉन्फ़िगरेशन',
    },
    common: {
      cancel: 'रद्द करें',
      back: 'वापस',
      next: 'अगला',
      create: 'बनाएँ',
      verify: 'सत्यापित करें',
      authorize: 'अधिकार देना',
      creating: 'बना रहा हूँ...',
      verifying: 'सत्यापित किया जा रहा है...',
      authorizing: 'अधिकृत किया जा रहा है...',
    },
    oauthRedirectInfo: 'चूंकि इस टूल प्रदाता के लिए कोई सिस्टम क्लाइंट सीक्रेट्स नहीं मिले, इसलिए इसे मैनुअली सेटअप करने की आवश्यकता है, redirect_uri के लिए कृपया उपयोग करें',
    apiKey: {
      title: 'एपीआई कुंजी के साथ बनाएं',
      verify: {
        title: 'क्रेडेंशियल्स सत्यापित करें',
        description: 'कृपया पहुँच सत्यापित करने के लिए अपने API क्रेडेंशियल्स प्रदान करें',
        error: 'सत्यापन विफल हुआ। कृपया अपनी API कुंजी जांचें।',
        success: 'प्रमाण-पत्र सफलतापूर्वक सत्यापित किए गए',
      },
      configuration: {
        title: 'सदस्यता कॉन्फ़िगर करें',
        description: 'अपनी सदस्यता सेटिंग्स सेट करें',
      },
    },
    oauth: {
      title: 'OAuth के साथ बनाएं',
      authorization: {
        title: 'OAuth प्राधिकरण',
        description: 'अपने खाते तक पहुँचने के लिए Dify को अधिकृत करें',
        redirectUrl: 'पुनःमार्गित करें URL',
        redirectUrlHelp: 'अपने OAuth ऐप कॉन्फ़िगरेशन में इस URL का उपयोग करें',
        authorizeButton: '{{provider}} के साथ प्राधिकृत करें',
        waitingAuth: 'अनुमति की प्रतीक्षा कर रहे हैं...',
        authSuccess: 'प्राधिकरण सफल',
        authFailed: 'OAuth प्राधिकरण जानकारी प्राप्त करने में विफल',
        waitingJump: 'अधिकृत, कूदने की प्रतीक्षा कर रहा है',
      },
      configuration: {
        title: 'सदस्यता कॉन्फ़िगर करें',
        description: 'अधिकार के बाद अपनी सदस्यता पैरामीटर सेट करें',
        success: 'OAuth कॉन्फ़िगरेशन सफल',
        failed: 'OAuth कॉन्फ़िगरेशन विफल हुआ',
      },
      remove: {
        success: 'OAuth सफलतापूर्वक हटा दिया गया',
        failed: 'OAuth हटाने में विफल',
      },
      save: {
        success: 'OAuth कॉन्फ़िगरेशन सफलतापूर्वक सहेजा गया',
      },
    },
    manual: {
      title: 'मैनुअल सेटअप',
      description: 'अपने वेबहुक सब्सक्रिप्शन को मैन्युअली कॉन्फ़िगर करें',
      logs: {
        title: 'अनुरोध लॉग',
        request: 'अनुरोध',
        loading: '{{pluginName}} से अनुरोध की प्रतीक्षा कर रहे हैं...',
      },
    },
    form: {
      subscriptionName: {
        label: 'सदस्यता का नाम',
        placeholder: 'सब्सक्रिप्शन नाम दर्ज करें',
        required: 'सदस्यता का नाम आवश्यक है',
      },
      callbackUrl: {
        label: 'कॉलबैक URL',
        description: 'यह URL वेबहुक इवेंट प्राप्त करेगा',
        tooltip: 'एक सार्वजनिक रूप से सुलभ एन्डपॉइंट प्रदान करें जो ट्रिगर प्रदाता से कॉलबैक अनुरोध प्राप्त कर सके।',
        placeholder: 'उत्पादन हो रहा है...',
        privateAddressWarning: 'यह URL आंतरिक पता प्रतीत होता है, जिससे वेबहुक अनुरोध विफल हो सकते हैं। आप TRIGGER_URL को एक सार्वजनिक पते में बदल सकते हैं।',
      },
    },
    errors: {
      createFailed: 'सब्सक्रिप्शन बनाने में असफल',
      verifyFailed: 'प्रमाणीकरण सत्यापित करने में विफल',
      authFailed: 'प्राधिकरण असफल',
      networkError: 'नेटवर्क त्रुटि, कृपया फिर से प्रयास करें',
    },
  },
  events: {
    title: 'उपलब्ध कार्यक्रम',
    description: 'इवेंट्स जिन्हें यह ट्रिगर प्लगइन सब्सक्राइब कर सकता है',
    empty: 'कोई घटना उपलब्ध नहीं है',
    event: 'घटना',
    events: 'कार्यक्रम',
    actionNum: '{{num}} {{event}} शामिल',
    item: {
      parameters: '{{count}} पैरामीटर',
      noParameters: 'कोई पैरामीटर नहीं',
    },
    output: 'आउटपुट',
  },
  node: {
    status: {
      warning: 'विच्छेद करें',
    },
  },
}

export default translation
