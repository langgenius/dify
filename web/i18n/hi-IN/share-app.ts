const translation = {
  common: {
    welcome: 'आपका स्वागत है',
    appUnavailable: 'ऐप उपलब्ध नहीं है',
    appUnknownError: 'अज्ञात त्रुटि, कृपया पुनः प्रयास करें',
    appUnknownError: 'ऐप अनुपलब्ध है',
  },
  chat: {
    newChat: 'नया चैट',
    pinnedTitle: 'पिन किया गया',
    unpinnedTitle: 'चैट',
    newChatDefaultName: 'नया संवाद',
    resetChat: 'संवाद रीसेट करें',
    poweredBy: 'संचालित है',
    prompt: 'प्रॉम्प्ट',
    privatePromptConfigTitle: 'संवाद सेटिंग्स',
    publicPromptConfigTitle: 'प्रारंभिक प्रॉम्प्ट',
    configStatusDes: 'शुरू करने से पहले, आप संवाद सेटिंग्स को बदल सकते हैं',
    configDisabled:
      'इस सत्र के लिए पिछले सत्र की सेटिंग्स का उपयोग किया गया है।',
    startChat: 'चैट शुरू करें',
    privacyPolicyLeft: 'कृपया पढ़ें ',
    privacyPolicyMiddle: 'गोपनीयता नीति',
    privacyPolicyRight: ' ऐप डेवलपर द्वारा प्रदान की गई।',
    deleteConversation: {
      title: 'संवाद हटाएं',
      content: 'क्या आप इस संवाद को हटाना चाहते हैं?',
    },
    tryToSolve: 'समाधान करने का प्रयास करें',
    temporarySystemIssue: 'अभी सिस्टम में समस्या है, कृपया पुनः प्रयास करें।',
  },
  generation: {
    tabs: {
      create: 'एक बार चलाएं',
      batch: 'बैच चलाएं',
      saved: 'सहेजा गया',
    },
    savedNoData: {
      title: 'आपने अभी तक कोई परिणाम नहीं सहेजा है!',
      description:
        'सामग्री बनाना शुरू करें और यहाँ अपने सहेजे गए परिणाम देखें।',
      startCreateContent: 'सामग्री बनाना शुरू करें',
    },
    title: 'एआई पूर्णता',
    queryTitle: 'प्रश्न सामग्री',
    completionResult: 'पूर्णता परिणाम',
    queryPlaceholder: 'अपना प्रश्न लिखें...',
    run: 'चालू करें',
    copy: 'कॉपी करें',
    resultTitle: 'एआई पूर्णता',
    noData: 'एआई आपको यहाँ चाहिए।',
    csvUploadTitle: 'अपनी सीएसवी फ़ाइल यहाँ ड्रैग और ड्रॉप करें, या ',
    browse: 'ब्राउज़ करें',
    csvStructureTitle: 'सीएसवी फ़ाइल को निम्नलिखित संरचना का पालन करना चाहिए:',
    downloadTemplate: 'टेम्पलेट यहाँ डाउनलोड करें',
    field: 'क्षेत्र',
    batchFailed: {
      info: '{{num}} विफल कार्यान्वयन',
      retry: 'पुनः प्रयास करें',
      outputPlaceholder: 'कोई आउटपुट सामग्री नहीं',
    },
    errorMsg: {
      empty: 'कृपया अपलोड किए गए फ़ाइल में सामग्री भरें।',
      fileStructNotMatch:
        'अपलोड की गई सीएसवी फ़ाइल संरचना से मेल नहीं खाती है।',
      emptyLine: 'रॉ {{rowIndex}} खाली है',
      invalidLine: 'रॉ {{rowIndex}}: {{varName}} मान खाली नहीं हो सकता',
      moreThanMaxLengthLine:
        'रॉ {{rowIndex}}: {{varName}} मान {{maxLength}} वर्णों से अधिक नहीं हो सकता',
      atLeastOne: 'कृपया अपलोड की गई फ़ाइल में कम से कम एक पंक्ति भरें।',
    },
  },
}

export default translation
