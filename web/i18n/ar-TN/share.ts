const translation = {
  common: {
    welcome: '',
    appUnavailable: 'التطبيق غير متوفر',
    appUnknownError: 'التطبيق غير متوفر',
  },
  chat: {
    newChat: 'بدء دردشة جديدة',
    newChatTip: 'موجود بالفعل في دردشة جديدة',
    chatSettingsTitle: 'إعداد الدردشة الجديدة',
    chatFormTip: 'لا يمكن تعديل إعدادات الدردشة بعد بدء الدردشة.',
    pinnedTitle: 'مثبت',
    unpinnedTitle: 'الأخيرة',
    newChatDefaultName: 'محادثة جديدة',
    resetChat: 'إعادة تعيين المحادثة',
    viewChatSettings: 'عرض إعدادات الدردشة',
    poweredBy: 'مشغل بواسطة',
    prompt: 'مطالبة',
    privatePromptConfigTitle: 'إعدادات المحادثة',
    publicPromptConfigTitle: 'المطالبة الأولية',
    configStatusDes: 'قبل البدء، يمكنك تعديل إعدادات المحادثة',
    configDisabled:
      'تم استخدام إعدادات الجلسة السابقة لهذه الجلسة.',
    startChat: 'بدء الدردشة',
    privacyPolicyLeft:
      'يرجى قراءة ',
    privacyPolicyMiddle:
      'سياسة الخصوصية',
    privacyPolicyRight:
      ' المقدمة من مطور التطبيق.',
    deleteConversation: {
      title: 'حذف المحادثة',
      content: 'هل أنت متأكد أنك تريد حذف هذه المحادثة؟',
    },
    tryToSolve: 'حاول الحل',
    temporarySystemIssue: 'عذرًا، مشكلة مؤقتة في النظام.',
    expand: 'توسيع',
    collapse: 'طي',
  },
  generation: {
    tabs: {
      create: 'تشغيل مرة واحدة',
      batch: 'تشغيل دفعة',
      saved: 'محفوظ',
    },
    savedNoData: {
      title: 'لم تقم بحفظ نتيجة بعد!',
      description: 'ابدأ في إنشاء المحتوى، وابحث عن نتائجك المحفوظة هنا.',
      startCreateContent: 'ابدأ في إنشاء المحتوى',
    },
    title: 'إكمال الذكاء الاصطناعي',
    queryTitle: 'محتوى الاستعلام',
    completionResult: 'نتيجة الإكمال',
    queryPlaceholder: 'اكتب محتوى الاستعلام الخاص بك...',
    run: 'تنفيذ',
    execution: 'تشغيل',
    executions: '{{num}} عمليات تشغيل',
    copy: 'نسخ',
    resultTitle: 'إكمال الذكاء الاصطناعي',
    noData: 'سيعطيك الذكاء الاصطناعي ما تريد هنا.',
    csvUploadTitle: 'اسحب وأفلت ملف CSV هنا، أو ',
    browse: 'تصفح',
    csvStructureTitle: 'يجب أن يتوافق ملف CSV مع الهيكل التالي:',
    downloadTemplate: 'تنزيل النموذج هنا',
    field: 'حقل',
    stopRun: 'إيقاف التشغيل',
    batchFailed: {
      info: '{{num}} عمليات تنفيذ فاشلة',
      retry: 'إعادة المحاولة',
      outputPlaceholder: 'لا يوجد محتوى إخراج',
    },
    errorMsg: {
      empty: 'يرجى إدخال محتوى في الملف الذي تم تحميله.',
      fileStructNotMatch: 'ملف CSV الذي تم تحميله لا يطابق الهيكل.',
      emptyLine: 'الصف {{rowIndex}} فارغ',
      invalidLine: 'الصف {{rowIndex}}: قيمة {{varName}} لا يمكن أن تكون فارغة',
      moreThanMaxLengthLine: 'الصف {{rowIndex}}: قيمة {{varName}} لا يمكن أن تكون أكثر من {{maxLength}} حرفًا',
      atLeastOne: 'يرجى إدخال صف واحد على الأقل في الملف الذي تم تحميله.',
    },
  },
  login: {
    backToHome: 'العودة إلى الصفحة الرئيسية',
  },
}

export default translation
