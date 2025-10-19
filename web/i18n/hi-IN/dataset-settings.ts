const translation = {
  title: 'ज्ञान सेटिंग्ज',
  desc: 'यहां आप ज्ञान की संपत्ति और कार्य प्रक्रियाओं को modify कर सकते हैं.',
  form: {
    name: 'ज्ञान नाम',
    namePlaceholder: 'कृपया ज्ञान नाम दर्ज करें',
    nameError: 'नाम रिक्त नहीं होना चाहिए',
    desc: 'ज्ञान विवरण',
    descInfo:
      'कृपया स्पष्ट साक्षर विवरण लिखें जिससे AI को ज्ञान के निहितार्थों की पहचान करने में मदद मिले। यदि शून्य है, Dify आपके पूर्वानुमान का उपयोग करेगा।',
    descPlaceholder:
      'इस ज्ञान के सामग्रियां क्या हैं? एक विस्तृत विवरण को AI को निहितार्थों की पहचान करने में मदद मिले। यदि शून्य है, Dify आपके पूर्वानुमान का उपयोग करेगा।',
    descWrite: 'कैसे अच्छा ज्ञान विवरण लिखना है?',
    permissions: 'अनुमतियां',
    permissionsOnlyMe: 'मेरे लिए ही',
    permissionsAllMember: 'सभी टीम सदस्यों के लिए',
    indexMethod: 'सूचीकरण प्रक्रिया',
    indexMethodHighQuality: ' उच्च गुणवत्ता',
    indexMethodHighQualityTip:
      'उपयोगकर्ता के प्रश्नों के समय उच्च सटीकता प्रदान करने के लिए Embedding मॉडल को प्रोसेसिंग के लिए कॉल करें।',
    indexMethodEconomy: 'आर्थिक',
    indexMethodEconomyTip:
      'ऑफ़लाइन वेक्टर इंजन, कीवर्ड इंडेक्स आदि का उपयोग करें ताकि टोकनों की बचत हो।',
    embeddingModel: 'एम्बेडिंग मॉडल',
    embeddingModelTip: 'एम्बेडिंग मॉडल को बदलें, कृपया ',
    embeddingModelTipLink: 'सेटिंग्ज',
    retrievalSetting: {
      title: 'प्राप्ति सेटिंग्ज',
      learnMore: 'और अधिक सीखना',
      description: 'प्राप्ति पद्धति के बारे में。',
      longDescription:
        'प्राप्ति पद्धति के बारे में, आप इसे किसी भी समय ज्ञान सेटिंग्ज में बदल सकते हैं।',
      method: 'प्राप्ति विधि',
    },
    save: 'सेवना',
    me: '(आप)',
    permissionsInvitedMembers: 'आंशिक टीम के सदस्य',
    externalKnowledgeID: 'बाहरी ज्ञान ID',
    externalKnowledgeAPI: 'बाहरी ज्ञान एपीआई',
    retrievalSettings: 'पुनर्प्राप्ति सेटिंग्स',
    indexMethodChangeToEconomyDisabledTip: 'मुख्यालय से ईसीओ में डाउनग्रेड करने के लिए उपलब्ध नहीं है',
    helpText: 'एक अच्छा डेटासेट विवरण लिखना सीखें।',
    upgradeHighQualityTip: 'एक बार उच्च गुणवत्ता मोड में अपग्रेड करने के बाद, किफायती मोड में वापस जाना उपलब्ध नहीं है',
    searchModel: 'मॉडल खोजें',
    chunkStructure: {
      learnMore: 'और अधिक सीखें',
      title: 'खंड संरचना',
      description: 'चंक संरचना के बारे में।',
    },
    nameAndIcon: 'नाम और आइकन',
    numberOfKeywords: 'कीवर्ड की संख्या',
    onSearchResults: 'कोई सदस्य आपकी खोज क्वेरी से मेल नहीं खाता। अपनी खोज को फिर से प्रयास करें।',
  },
}

export default translation
