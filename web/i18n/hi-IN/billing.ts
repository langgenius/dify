const translation = {
  currentPlan: 'वर्तमान योजना',
  upgradeBtn: {
    plain: 'योजना अपग्रेड करें',
    encourage: 'अभी अपग्रेड करें',
    encourageShort: 'अपग्रेड करें',
  },
  viewBilling: 'बिलिंग और सब्सक्रिप्शन प्रबंधित करें',
  buyPermissionDeniedTip:
    'सब्सक्राइब करने के लिए कृपया अपने एंटरप्राइज़ व्यवस्थापक से संपर्क करें',
  plansCommon: {
    title: 'आपके लिए सही योजना चुनें',
    yearlyTip: 'वार्षिक सब्सक्राइब करने पर 2 महीने मुफ्त पाएं!',
    mostPopular: 'सबसे लोकप्रिय',
    planRange: {
      monthly: 'मासिक',
      yearly: 'वार्षिक',
    },
    month: 'महीना',
    year: 'साल',
    save: 'बचत करें ',
    free: 'मुफ्त',
    currentPlan: 'वर्तमान योजना',
    contractSales: 'बिक्री से संपर्क करें',
    contractOwner: 'टीम प्रबंधक से संपर्क करें',
    startForFree: 'मुफ्त में शुरू करें',
    getStartedWith: 'इसके साथ शुरू करें ',
    contactSales: 'बिक्री से संपर्क करें',
    talkToSales: 'बिक्री से बात करें',
    modelProviders: 'मॉडल प्रदाता',
    teamMembers: 'टीम के सदस्य',
    annotationQuota: 'एनोटेशन कोटा',
    buildApps: 'ऐप्स बनाएं',
    vectorSpace: 'वेक्टर स्पेस',
    vectorSpaceBillingTooltip:
      'प्रत्येक 1MB लगभग 1.2 मिलियन वर्णों के वेक्टराइज्ड डेटा को संग्रहीत कर सकता है (OpenAI एम्बेडिंग का उपयोग करके अनुमानित, मॉडल में भिन्नता होती है)।',
    vectorSpaceTooltip:
      'वेक्टर स्पेस वह दीर्घकालिक स्मृति प्रणाली है जिसकी आवश्यकता LLMs को आपके डेटा को समझने के लिए होती है।',
    documentsUploadQuota: 'दस्तावेज़ अपलोड कोटा',
    documentProcessingPriority: 'दस्तावेज़ प्रसंस्करण प्राथमिकता',
    documentProcessingPriorityTip:
      'उच्च दस्तावेज़ प्रसंस्करण प्राथमिकता के लिए, कृपया अपनी योजना अपग्रेड करें।',
    documentProcessingPriorityUpgrade:
      'तेजी से गति पर उच्च सटीकता के साथ अधिक डेटा संसाधित करें।',
    priority: {
      'standard': 'मानक',
      'priority': 'प्राथमिकता',
      'top-priority': 'शीर्ष प्राथमिकता',
    },
    logsHistory: 'लॉग इतिहास',
    customTools: 'कस्टम टूल्स',
    unavailable: 'अनुपलब्ध',
    days: 'दिन',
    unlimited: 'असीमित',
    support: 'समर्थन',
    supportItems: {
      communityForums: 'समुदाय फोरम',
      emailSupport: 'ईमेल समर्थन',
      priorityEmail: 'प्राथमिकता ईमेल और चैट समर्थन',
      logoChange: 'लोगो परिवर्तन',
      SSOAuthentication: 'SSO प्रमाणीकरण',
      personalizedSupport: 'व्यक्तिगत समर्थन',
      dedicatedAPISupport: 'समर्पित API समर्थन',
      customIntegration: 'कस्टम एकीकरण और समर्थन',
      ragAPIRequest: 'RAG API अनुरोध',
      bulkUpload: 'दस्तावेजों का थोक अपलोड',
      agentMode: 'एजेंट मोड',
      workflow: 'कार्यप्रवाह',
      llmLoadingBalancing: 'LLM लोड बैलेंसिंग',
      llmLoadingBalancingTooltip:
        'मॉडल्स में कई API कुंजियाँ जोड़ें, प्रभावी रूप से API दर सीमाओं को बायपास करें।',
    },
    comingSoon: 'जल्द आ रहा है',
    member: 'सदस्य',
    memberAfter: 'सदस्य',
    messageRequest: {
      title: 'संदेश क्रेडिट्स',
      tooltip:
        'विभिन्न योजनाओं के लिए संदेश आह्वान कोटा OpenAI मॉडलों का उपयोग करके (gpt4 को छोड़कर)। सीमा से अधिक संदेश आपके OpenAI API कुंजी का उपयोग करेंगे।',
    },
    annotatedResponse: {
      title: 'एनोटेशन कोटा सीमाएं',
      tooltip:
        'प्रतिक्रियाओं का मैन्युअल संपादन और एनोटेशन ऐप्स के लिए अनुकूलन योग्य उच्च-गुणवत्ता वाले प्रश्न-उत्तर क्षमताएं प्रदान करता है। (केवल चैट ऐप्स में लागू)',
    },
    ragAPIRequestTooltip:
      'Dify की केवल ज्ञान आधार प्रसंस्करण क्षमताओं को आह्वान करने वाले API कॉल की संख्या को संदर्भित करता है।',
    receiptInfo:
      'केवल टीम के मालिक और टीम एडमिन सब्सक्राइब कर सकते हैं और बिलिंग जानकारी देख सकते हैं',
  },
  plans: {
    sandbox: {
      name: 'सैंडबॉक्स',
      description: '200 बार GPT मुफ्त ट्रायल',
      includesTitle: 'शामिल हैं:',
    },
    professional: {
      name: 'प्रोफेशनल',
      description:
        'व्यक्तियों और छोटे टीमों के लिए अधिक शक्ति सस्ती दर पर खोलें।',
      includesTitle: 'मुफ्त योजना में सब कुछ, साथ में:',
    },
    team: {
      name: 'टीम',
      description:
        'बिना सीमा के सहयोग करें और शीर्ष स्तरीय प्रदर्शन का आनंद लें।',
      includesTitle: 'प्रोफेशनल योजना में सब कुछ, साथ में:',
    },
    enterprise: {
      name: 'एंटरप्राइज़',
      description:
        'बड़े पैमाने पर मिशन-क्रिटिकल सिस्टम के लिए पूर्ण क्षमताएं और समर्थन प्राप्त करें।',
      includesTitle: 'टीम योजना में सब कुछ, साथ में:',
    },
  },
  vectorSpace: {
    fullTip: 'वेक्टर स्पेस पूर्ण है।',
    fullSolution: 'अधिक स्थान प्राप्त करने के लिए अपनी योजना अपग्रेड करें।',
  },
  apps: {
    fullTipLine1: 'अधिक ऐप्स बनाने के लिए',
    fullTipLine2: 'अपनी योजना अपग्रेड करें।',
  },
  annotatedResponse: {
    fullTipLine1: 'अधिक बातचीत को एनोटेट करने के लिए',
    fullTipLine2: 'अपनी योजना अपग्रेड करें।',
    quotaTitle: 'एनोटेशन उत्तर कोटा',
  },
}

export default translation
