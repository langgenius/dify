const translation = {
  category: {
    models: 'मॉडल्स',
    all: 'सभी',
    bundles: 'बंडल',
    extensions: 'एक्सटेंशन्स',
    tools: 'उपकरण',
    agents: 'एजेंट रणनीतियाँ',
    datasources: 'डेटा स्रोत',
  },
  categorySingle: {
    extension: 'विस्तार',
    bundle: 'बंडल',
    tool: 'उपकरण',
    agent: 'एजेंट रणनीति',
    model: 'मॉडल',
    datasource: 'डेटा स्रोत',
  },
  list: {
    source: {
      marketplace: 'मार्केटप्लेस से इंस्टॉल करें',
      github: 'गिटहब से इंस्टॉल करें',
      local: 'स्थानीय पैकेज फ़ाइल से स्थापित करें',
    },
    notFound: 'कोई प्लगइन नहीं मिला',
    noInstalled: 'कोई प्लगइन स्थापित नहीं हैं',
  },
  source: {
    github: 'गिटहब',
    local: 'स्थानीय पैकेज फ़ाइल',
    marketplace: 'बाजार',
  },
  detailPanel: {
    categoryTip: {
      github: 'गिटहब से स्थापित किया गया',
      local: 'स्थानीय प्लगइन',
      marketplace: 'मार्केटप्लेस से स्थापित किया गया',
      debugging: 'डिबगिंग प्लगइन',
    },
    operation: {
      info: 'प्लगइन जानकारी',
      remove: 'हटाएं',
      checkUpdate: 'अपडेट जांचें',
      viewDetail: 'विवरण देखें',
      install: 'स्थापित करें',
      detail: 'विवरण',
      update: 'अपडेट',
    },
    toolSelector: {
      uninstalledTitle: 'उपकरण स्थापित नहीं है',
      auto: 'स्वचालित',
      uninstalledLink: 'प्लगइन्स में प्रबंधित करें',
      unsupportedTitle: 'असमर्थित क्रिया',
      unsupportedContent:
        'स्थापित प्लगइन संस्करण यह क्रिया प्रदान नहीं करता है।',
      descriptionLabel: 'उपकरण का विवरण',
      unsupportedContent2: 'संस्करण बदलने के लिए क्लिक करें।',
      placeholder: 'एक उपकरण चुनें...',
      title: 'उपकरण जोड़ें',
      toolLabel: 'उपकरण',
      params: 'कारण निर्धारण कॉन्फ़िग',
      empty:
        'उपकरण जोड़ने के लिए \'+\' बटन पर क्लिक करें। आप कई उपकरण जोड़ सकते हैं।',
      settings: 'उपयोगकर्ता सेटिंग्स',
      uninstalledContent:
        'यह प्लगइन स्थानीय/गिटहब रिपॉजिटरी से स्थापित किया गया है। कृपया स्थापना के बाद उपयोग करें।',
      paramsTip2:
        'जब \'स्वचालित\' बंद होता है, तो डिफ़ॉल्ट मान का उपयोग किया जाता है।',
      descriptionPlaceholder:
        'उपकरण के उद्देश्य का संक्षिप्त विवरण, जैसे, किसी विशेष स्थान के लिए तापमान प्राप्त करना।',
      paramsTip1: 'एलएलएम अनुमान पैरामीटर को नियंत्रित करता है।',
      toolSetting: 'टूल सेटिंग्स',
      unsupportedMCPTool:
        'वर्तमान में चयनित एजेंट रणनीति प्लगइन संस्करण MCP टूल का समर्थन नहीं करता है।',
    },
    switchVersion: 'स्विच संस्करण',
    endpointModalDesc:
      'एक बार कॉन्फ़िगर होने के बाद, प्लगइन द्वारा API एंडपॉइंट्स के माध्यम से प्रदान की गई सुविधाओं का उपयोग किया जा सकता है।',
    actionNum: '{{num}} {{action}} शामिल है',
    endpointDeleteTip: 'एंडपॉइंट हटाएं',
    endpointsDocLink: 'दस्तावेज़ देखें',
    disabled: 'अक्षम',
    modelNum: '{{num}} मॉडल शामिल हैं',
    endpoints: 'एंडपॉइंट्स',
    endpointDeleteContent: 'क्या आप {{name}} को हटाना चाहेंगे?',
    serviceOk: 'सेवा ठीक है',
    configureTool: 'उपकरण कॉन्फ़िगर करें',
    configureApp: 'ऐप कॉन्फ़िगर करें',
    endpointDisableContent: 'क्या आप {{name}} को अक्षम करना चाहेंगे?',
    endpointDisableTip: 'एंडपॉइंट अक्षम करें',
    configureModel: 'मॉडल कॉन्फ़िगर करें',
    endpointsEmpty: 'एक एंडपॉइंट जोड़ने के लिए \'+\' बटन पर क्लिक करें',
    endpointModalTitle: 'एंडपॉइंट सेटअप करें',
    strategyNum: '{{num}} {{रणनीति}} शामिल',
    endpointsTip:
      'यह प्लगइन एंडपॉइंट्स के माध्यम से विशिष्ट कार्यक्षमताएँ प्रदान करता है, और आप वर्तमान कार्यक्षेत्र के लिए कई एंडपॉइंट सेट कॉन्फ़िगर कर सकते हैं।',
    deprecation: {
      reason: {
        noMaintainer: 'कोई देखभाल करने वाला नहीं',
        ownershipTransferred: 'स्वामित्व स्थानांतरित किया गया',
        businessAdjustments: 'व्यवसाय समायोजन',
      },
      noReason: 'यह प्लगइन अप्रचलित हो गया है और इसे अब अपडेट नहीं किया जाएगा।',
      onlyReason:
        'इस प्लगइन को {{deprecatedReason}} के कारण अमान्य कर दिया गया है और इसे अब अपडेट नहीं किया जाएगा।',
      fullMessage:
        'इस प्लगइन को {{deprecatedReason}} के कारण अमान्य कर दिया गया है, और इसे अब अपडेट नहीं किया जाएगा। कृपया इसके बजाय <CustomLink href=\'https://example.com/\'>{{-alternativePluginId}}</CustomLink> का उपयोग करें।',
    },
  },
  debugInfo: {
    viewDocs: 'दस्तावेज़ देखें',
    title: 'डिबगिंग',
  },
  privilege: {
    whoCanDebug: 'कौन प्लगइन्स को डिबग कर सकता है?',
    whoCanInstall: 'कौन प्लगइन्स को स्थापित और प्रबंधित कर सकता है?',
    noone: 'कोई नहीं',
    everyone: 'सभी',
    title: 'प्लगइन प्राथमिकताएँ',
    admins: 'व्यवस्थापक',
  },
  pluginInfoModal: {
    repository: 'भंडार',
    packageName: 'पैकेज',
    release: 'रिहाई',
    title: 'प्लगइन जानकारी',
  },
  action: {
    pluginInfo: 'प्लगइन जानकारी',
    checkForUpdates: 'अपडेट के लिए जांचें',
    deleteContentLeft: 'क्या आप हटाना चाहेंगे',
    deleteContentRight: 'प्लगइन?',
    usedInApps: 'यह प्लगइन {{num}} ऐप्स में उपयोग किया जा रहा है।',
    delete: 'प्लगइन हटाएं',
  },
  installModal: {
    labels: {
      repository: 'भंडार',
      package: 'पैकेज',
      version: 'संस्करण',
    },
    uploadFailed: 'अपलोड विफल',
    next: 'अगला',
    cancel: 'रद्द करें',
    pluginLoadErrorDesc: 'यह प्लगइन स्थापित नहीं किया जाएगा',
    back: 'पीछे',
    installComplete: 'स्थापना पूर्ण',
    installPlugin: 'प्लगइन स्थापित करें',
    readyToInstallPackages: 'निम्नलिखित {{num}} प्लगइन्स स्थापित करने वाले हैं',
    install: 'स्थापित करें',
    close: 'करीब',
    uploadingPackage: '{{packageName}} अपलोड हो रहा है...',
    installing: 'स्थापित कर रहा है...',
    installedSuccessfully: 'स्थापना सफल',
    dropPluginToInstall:
      'यहां प्लगइन पैकेज ड्रॉप करें ताकि इसे स्थापित किया जा सके',
    readyToInstallPackage: 'निम्नलिखित प्लगइन स्थापित करने वाले हैं',
    pluginLoadError: 'प्लगइन लोड त्रुटि',
    installFailed: 'स्थापना विफल हो गई',
    readyToInstall: 'निम्नलिखित प्लगइन स्थापित करने वाले हैं',
    installFailedDesc: 'प्लगइन स्थापित करने में विफल रहा।',
    installedSuccessfullyDesc: 'प्लगइन सफलतापूर्वक स्थापित किया गया है।',
    fromTrustSource:
      'कृपया सुनिश्चित करें कि आप केवल एक <trustSource>विश्वसनीय स्रोत</trustSource> से प्लगइन्स स्थापित करें।',
    installWarning: 'इस प्लगइन को स्थापित करने की अनुमति नहीं है।',
  },
  installFromGitHub: {
    gitHubRepo: 'गिटहब रिपॉजिटरी',
    selectPackage: 'पैकेज चुनें',
    selectVersionPlaceholder: 'कृपया एक संस्करण चुनें',
    selectVersion: 'संस्करण चुनें',
    updatePlugin: 'गिटहब से प्लगइन अपडेट करें',
    installPlugin: 'GitHub से प्लगइन स्थापित करें',
    selectPackagePlaceholder: 'कृपया एक पैकेज चुनें',
    installNote:
      'कृपया सुनिश्चित करें कि आप केवल एक विश्वसनीय स्रोत से प्लगइन्स स्थापित करें।',
    installedSuccessfully: 'स्थापना सफल',
    installFailed: 'स्थापना विफल हो गई',
    uploadFailed: 'अपलोड विफल',
  },
  upgrade: {
    title: 'प्लगइन स्थापित करें',
    close: 'करीब',
    upgrade: 'स्थापित करें',
    upgrading: 'स्थापित कर रहा है...',
    successfulTitle: 'स्थापना सफल',
    description: 'निम्नलिखित प्लगइन स्थापित करने वाले हैं',
    usedInApps: '{{num}} ऐप्स में उपयोग किया गया',
  },
  error: {
    inValidGitHubUrl:
      'अमान्य GitHub URL। कृपया निम्नलिखित प्रारूप में एक मान्य URL दर्ज करें: https://github.com/owner/repo',
    noReleasesFound:
      'कोई रिलीज़ नहीं मिली। कृपया GitHub रिपॉजिटरी या इनपुट URL की जांच करें।',
    fetchReleasesError:
      'रिलीज़ प्राप्त करने में असमर्थ। कृपया बाद में फिर से प्रयास करें।',
  },
  marketplace: {
    sortOption: {
      mostPopular: 'सबसे लोकप्रिय',
      newlyReleased: 'नवीनतम जारी किया गया',
      firstReleased: 'पहली बार जारी किया गया',
      recentlyUpdated: 'हाल ही में अपडेट किया गया',
    },
    pluginsResult: '{{num}} परिणाम',
    empower: 'अपने एआई विकास को सशक्त बनाएं',
    noPluginFound: 'कोई प्लगइन नहीं मिला',
    viewMore: 'और देखें',
    moreFrom: 'मार्केटप्लेस से अधिक',
    and: 'और',
    difyMarketplace: 'डिफाई मार्केटप्लेस',
    sortBy: 'काला शहर',
    discover: 'खोजें',
    partnerTip: 'Dify भागीदार द्वारा सत्यापित',
    verifiedTip: 'डिफाई द्वारा सत्यापित',
  },
  task: {
    clearAll: 'सभी साफ करें',
    installing: '{{installingLength}} प्लगइन्स स्थापित कर रहे हैं, 0 पूरा हुआ।',
    installError:
      '{{errorLength}} प्लगइन्स स्थापित करने में विफल रहे, देखने के लिए क्लिक करें',
    installedError: '{{errorLength}} प्लगइन्स स्थापित करने में विफल रहे',
    installingWithError:
      '{{installingLength}} प्लगइन्स स्थापित कर रहे हैं, {{successLength}} सफल, {{errorLength}} विफल',
    installingWithSuccess:
      '{{installingLength}} प्लगइन्स स्थापित कर रहे हैं, {{successLength}} सफल।',
  },
  installFrom: 'से इंस्टॉल करें',
  fromMarketplace: 'मार्केटप्लेस से',
  searchPlugins: 'खोज प्लगइन्स',
  install: '{{num}} इंस्टॉलेशन',
  allCategories: 'सभी श्रेणियाँ',
  search: 'खोज',
  searchTools: 'खोज उपकरण...',
  searchCategories: 'खोज श्रेणियाँ',
  installAction: 'स्थापित करें',
  searchInMarketplace: 'मार्केटप्लेस में खोजें',
  installPlugin: 'प्लगइन स्थापित करें',
  findMoreInMarketplace: 'मार्केटप्लेस में और खोजें',
  endpointsEnabled: '{{num}} एंडपॉइंट्स के सेट सक्षम किए गए',
  from: 'से',
  metadata: {
    title: 'प्लगइन्स',
  },
  difyVersionNotCompatible:
    'वर्तमान डिफाई संस्करण इस प्लगइन के साथ संगत नहीं है, कृपया आवश्यक न्यूनतम संस्करण में अपग्रेड करें: {{minimalDifyVersion}}',
  requestAPlugin: 'एक प्लगइन का अनुरोध करें',
  publishPlugins: 'प्लगइन प्रकाशित करें',
  auth: {
    default: 'डिफ़ॉल्ट',
    useOAuth: 'OAuth का उपयोग करें',
    addOAuth: 'OAuth जोड़ें',
    authorizations: 'अनुमतियाँ',
    workspaceDefault: 'कार्यस्थल डिफ़ॉल्ट',
    setupOAuth: 'OAuth क्लाइंट सेट करें',
    custom: 'कस्टम',
    addApi: 'API कुंज जोड़ें',
    saveOnly: 'बस सहेजें',
    useApi: 'API कुंजी का उपयोग करें',
    authRemoved: 'प्राधिकरण हटाया गया',
    useOAuthAuth: 'OAuth प्राधिकरण का उपयोग करें',
    oauthClient: 'OAuth क्लाइंट',
    setDefault: 'डिफ़ॉल्ट के रूप में सेट करें',
    authorizationName: 'अनु autorización नाम',
    saveAndAuth: 'सहेजें और अधिकृत करें',
    useApiAuth: 'एपीआई कुंजी प्राधिकरण कॉन्फ़िगरेशन',
    oauthClientSettings: 'OAuth क्लाइंट सेटिंग्स',
    authorization: 'अधिकार',
    useApiAuthDesc:
      'क्रेडेंशियल्स कॉन्फ़िगर करने के बाद, कार्यक्षेत्र के सभी सदस्यों को एप्लिकेशन को व्यवस्थित करते समय इस उपकरण का उपयोग करने की अनुमति होती है।',
    clientInfo:
      'चूंकि इस टूल प्रदाता के लिए कोई सिस्टम क्लाइंट रहस्य नहीं पाए गए हैं, इसलिए इसे मैन्युअल रूप से सेटअप करना आवश्यक है, कृपया redirect_uri का उपयोग करें',
    unavailable: 'अप्राप्त',
    customCredentialUnavailable:
      'कस्टम क्रेडेंशियल वर्तमान में उपलब्ध नहीं हैं',
    credentialUnavailable:
      'वर्तमान में क्रेडेंशियल्स उपलब्ध नहीं हैं। कृपया प्रशासन से संपर्क करें।',
    credentialUnavailableInButton: 'प्रमाण पत्र उपलब्ध नहीं है',
    connectedWorkspace: 'संयुक्त कार्यक्षेत्र',
    emptyAuth: 'कृपया प्रमाणीकरण कॉन्फ़िगर करें',
  },
  deprecated: 'अनुशंसित नहीं',
  autoUpdate: {
    strategy: {
      disabled: {
        name: 'अक्षम',
        description: 'प्लगइन्स स्वचालित रूप से अपडेट नहीं होंगे',
      },
      fixOnly: {
        name: 'केवल ठीक करें',
        selectedDescription: 'केवल पैच संस्करणों के लिए स्वचालित अपडेट',
        description:
          'केवल पैच संस्करणों के लिए स्वचालित अद्यतन (जैसे, 1.0.1 → 1.0.2)। छोटा संस्करण परिवर्तन अद्यतन को ट्रिगर नहीं करेगा।',
      },
      latest: {
        name: 'नवीनतम',
        selectedDescription: 'हमेशा नवीनतम संस्करण पर अद्यतन करें',
        description: 'हमेशा नवीनतम संस्करण पर अद्यतन करें',
      },
    },
    upgradeMode: {
      all: 'सभी अपडेट करें',
      partial: 'केवल चयनित',
      exclude: 'चुने हुए को बाहर करें',
    },
    upgradeModePlaceholder: {
      partial:
        'केवल चयनित प्लगइन्स स्वतः अपडेट होंगे। वर्तमान में कोई प्लगइन चयनित नहीं है, इसलिए कोई प्लगइन स्वतः अपडेट नहीं होगा।',
      exclude: 'चुने हुए प्लगइन्स अपने आप अपडेट नहीं होंगे',
    },
    operation: {
      clearAll: 'सभी हटाएं',
      select: 'प्लगइन्स चुनें',
    },
    pluginDowngradeWarning: {
      downgrade: 'फिर भी डाउनग्रेड करें',
      title: 'प्लगइन डाउनग्रेड',
      exclude: 'स्वतः अपडेट से बाहर करें',
      description:
        'इस प्लगइन के लिए ऑटो-अपडेट वर्तमान में सक्षम है। संस्करण को डाउनग्रेड करने से आपके परिवर्तनों को अगली स्वचालित अद्यतन के दौरान ओवरराइट किया जा सकता है।',
    },
    noPluginPlaceholder: {
      noFound: 'कोई प्लगइन्स नहीं मिले',
      noInstalled: 'कोई प्लगइन स्थापित नहीं है',
    },
    updateTimeTitle: 'अद्यतन समय',
    updateSettings: 'सेटिंग्स अपडेट करें',
    automaticUpdates: 'स्वचालित अपडेट',
    partialUPdate:
      'केवल निम्नलिखित {{num}} प्लगइन्स स्वचालित रूप से अपडेट होंगे',
    nextUpdateTime: 'अगली ऑटो-अपडेट: {{time}}',
    updateTime: 'अद्यतन समय',
    specifyPluginsToUpdate: 'अपडेट करने के लिए प्लगइन्स निर्दिष्ट करें',
    changeTimezone:
      'समय क्षेत्र बदलने के लिए, <setTimezone>सेटिंग्स</setTimezone> पर जाएं',
    excludeUpdate:
      'निम्नलिखित {{num}} प्लगइन्स स्वचालित रूप से अपडेट नहीं होंगे',
  },
}

export default translation
