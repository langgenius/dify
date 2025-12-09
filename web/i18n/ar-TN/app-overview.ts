const translation = {
  welcome: {
    firstStepTip: 'للبدء،',
    enterKeyTip: 'أدخل مفتاح OpenAI API الخاص بك أدناه',
    getKeyTip: 'احصل على مفتاح API الخاص بك من لوحة تحكم OpenAI',
    placeholder: 'مفتاح OpenAI API الخاص بك (مثلا sk-xxxx)',
  },
  apiKeyInfo: {
    cloud: {
      trial: {
        title: 'أنت تستخدم حصة تجربة {{providerName}}.',
        description: 'يتم توفير حصة التجربة لأغراض الاختبار الخاصة بك. قبل استنفاد حصة التجربة، يرجى إعداد مزود النموذج الخاص بك أو شراء حصة إضافية.',
      },
      exhausted: {
        title: 'تم استنفاد حصة التجربة الخاصة بك، يرجى إعداد مفتاح API الخاص بك.',
        description: 'لقد استنفدت حصة التجربة الخاصة بك. يرجى إعداد مزود النموذج الخاص بك أو شراء حصة إضافية.',
      },
    },
    selfHost: {
      title: {
        row1: 'للبدء،',
        row2: 'قم بإعداد مزود النموذج الخاص بك أولاً.',
      },
    },
    callTimes: 'أوقات الاتصال',
    usedToken: 'رمز مستخدم',
    setAPIBtn: 'الذهاب لإعداد مزود النموذج',
    tryCloud: 'أو جرب النسخة السحابية من Dify مع عرض مجاني',
  },
  overview: {
    title: 'نظرة عامة',
    appInfo: {
      title: 'تطبيق ويب',
      explanation: 'تطبيق ويب AI جاهز للاستخدام',
      accessibleAddress: 'عنوان URL عام',
      preview: 'معاينة',
      launch: 'إطلاق',
      regenerate: 'إعادة إنشاء',
      regenerateNotice: 'هل تريد إعادة إنشاء عنوان URL العام؟',
      preUseReminder: 'يرجى تمكين تطبيق الويب قبل المتابعة.',
      enableTooltip: {
        description: 'لتمكين هذه الميزة، يرجى إضافة عقدة إدخال المستخدم إلى اللوحة. (قد تكون موجودة بالفعل في المسودة، وتدخل حيز التنفيذ بعد النشر)',
        learnMore: 'اعرف المزيد',
      },
      settings: {
        entry: 'الإعدادات',
        title: 'إعدادات تطبيق الويب',
        modalTip: 'إعدادات تطبيق الويب من جانب العميل. ',
        webName: 'اسم تطبيق الويب',
        webDesc: 'وصف تطبيق الويب',
        webDescTip: 'سيتم عرض هذا النص على جانب العميل، مما يوفر إرشادات أساسية حول كيفية استخدام التطبيق',
        webDescPlaceholder: 'أدخل وصف تطبيق الويب',
        language: 'اللغة',
        workflow: {
          title: 'سير العمل',
          subTitle: 'تفاصيل سير العمل',
          show: 'عرض',
          hide: 'إخفاء',
          showDesc: 'عرض أو إخفاء تفاصيل سير العمل في تطبيق الويب',
        },
        chatColorTheme: 'سمة لون الدردشة',
        chatColorThemeDesc: 'تعيين سمة لون روبوت الدردشة',
        chatColorThemeInverted: 'معكوس',
        invalidHexMessage: 'قيمة hex غير صالحة',
        invalidPrivacyPolicy: 'رابط سياسة الخصوصية غير صالح. يرجى استخدام رابط صالح يبدأ بـ http أو https',
        sso: {
          label: 'فرض SSO',
          title: 'تطبيق ويب SSO',
          description: 'يُطلب من جميع المستخدمين تسجيل الدخول باستخدام SSO قبل استخدام تطبيق الويب',
          tooltip: 'اتصل بالمسؤول لتمكين تطبيق ويب SSO',
        },
        more: {
          entry: 'عرض المزيد من الإعدادات',
          copyright: 'حقوق النشر',
          copyrightTip: 'عرض معلومات حقوق النشر في تطبيق الويب',
          copyrightTooltip: 'يرجى الترقية إلى الخطة الاحترافية أو أعلى',
          copyRightPlaceholder: 'أدخل اسم المؤلف أو المنظمة',
          privacyPolicy: 'سياسة الخصوصية',
          privacyPolicyPlaceholder: 'أدخل رابط سياسة الخصوصية',
          privacyPolicyTip: 'يساعد الزوار على فهم البيانات التي يجمعها التطبيق، راجع <privacyPolicyLink>سياسة الخصوصية</privacyPolicyLink> لـ Dify.',
          customDisclaimer: 'إخلاء مسؤولية مخصص',
          customDisclaimerPlaceholder: 'أدخل نص إخلاء المسؤولية المخصص',
          customDisclaimerTip: 'سيتم عرض نص إخلاء المسؤولية المخصص على جانب العميل، مما يوفر معلومات إضافية حول التطبيق',
        },
      },
      embedded: {
        entry: 'مضمن',
        title: 'تضمين في الموقع',
        explanation: 'اختر طريقة لتضمين تطبيق الدردشة في موقعك',
        iframe: 'لإضافة تطبيق الدردشة في أي مكان على موقعك، أضف هذا iframe إلى كود html الخاص بك.',
        scripts: 'لإضافة تطبيق دردشة إلى أسفل يمين موقعك، أضف هذا الكود إلى html الخاص بك.',
        chromePlugin: 'تثبيت ملحق Dify Chatbot Chrome',
        copied: 'تم النسخ',
        copy: 'نسخ',
      },
      qrcode: {
        title: 'رمز الاستجابة السريعة للرابط',
        scan: 'مسح للمشاركة',
        download: 'تحميل رمز الاستجابة السريعة',
      },
      customize: {
        way: 'طريقة',
        entry: 'تخصيص',
        title: 'تخصيص تطبيق ويب AI',
        explanation: 'يمكنك تخصيص الواجهة الأمامية لتطبيق الويب لتناسب سيناريو واحتياجات أسلوبك.',
        way1: {
          name: 'انسخ كود العميل، وقم بتعديله وانشره على Vercel (موصى به)',
          step1: 'انسخ كود العميل وقم بتعديله',
          step1Tip: 'انقر هنا لنسخ الكود المصدري إلى حساب GitHub الخاص بك وتعديل الكود',
          step1Operation: 'Dify-WebClient',
          step2: 'نشر على Vercel',
          step2Tip: 'انقر هنا لاستيراد المستودع إلى Vercel والنشر',
          step2Operation: 'استيراد المستودع',
          step3: 'تكوين متغيرات البيئة',
          step3Tip: 'أضف متغيرات البيئة التالية في Vercel',
        },
        way2: {
          name: 'كتابة كود من جانب العميل لاستدعاء API ونشره على خادم',
          operation: 'التوثيق',
        },
      },
    },
    apiInfo: {
      title: 'واجهة برمجة تطبيقات خدمة الخلفية',
      explanation: 'سهلة الدمج في تطبيقك',
      accessibleAddress: 'نقطة نهاية واجهة برمجة تطبيقات الخدمة',
      doc: 'مرجع API',
    },
    triggerInfo: {
      title: 'المشغلات',
      explanation: 'إدارة مشغلات سير العمل',
      triggersAdded: 'تمت إضافة {{count}} مشغلات',
      noTriggerAdded: 'لم تتم إضافة أي مشغل',
      triggerStatusDescription: 'تظهر حالة عقدة المشغل هنا. (قد تكون موجودة بالفعل في المسودة، وتدخل حيز التنفيذ بعد النشر)',
      learnAboutTriggers: 'تعرف على المشغلات',
    },
    status: {
      running: 'في الخدمة',
      disable: 'تعطيل',
    },
    disableTooltip: {
      triggerMode: 'ميزة {{feature}} غير مدعومة في وضع عقدة المشغل.',
    },
  },
  analysis: {
    title: 'تحليل',
    ms: 'مللي ثانية',
    tokenPS: 'الرموز/ثانية',
    totalMessages: {
      title: 'إجمالي الرسائل',
      explanation: 'عدد تفاعلات الذكاء الاصطناعي اليومية؛ يمنع هندسة/تصحيح المطالبة.',
    },
    totalConversations: {
      title: 'إجمالي المحادثات',
      explanation: 'عدد المحادثات اليومية للذكاء الاصطناعي؛ باستثناء هندسة/تصحيح المطالبة.',
    },
    activeUsers: {
      title: 'المستخدمون النشطون',
      explanation: 'المستخدمون الفريدون الذين يشاركون في Q&A مع المساعد؛ يستبعد هندسة/تصحيح المطالبة.',
    },
    tokenUsage: {
      title: 'استخدام الرموز',
      explanation: 'يعكس استخدام الرموز اليومية لنموذج اللغة لتطبيق WebApp، مفيدًا للتحكم في التكلفة.',
      consumed: 'المستهلكة',
    },
    avgSessionInteractions: {
      title: 'متوسط تفاعلات الجلسة',
      explanation: 'عدد مفاتيح التواصل المستمر بين المستخدم والذكاء الاصطناعي؛ للمطبيقات القائمة على المحادثة.',
    },
    avgUserInteractions: {
      title: 'متوسط تفاعلات المستخدم',
      explanation: 'يعكس تكرار الاستخدام اليومي للمستخدمين. يعكس هذا المقياس لزوجة المستخدم.',
    },
    userSatisfactionRate: {
      title: 'معدل رضا المستخدم',
      explanation: 'عدد الإعجابات لكل 1000 رسالة. يشير هذا إلى النسبة التي يرضى فيها المستخدمون للغاية عن الإجابات.',
    },
    avgResponseTime: {
      title: 'متوسط وقت الاستجابة',
      explanation: 'الوقت (مللي ثانية) حتى يقوم الذكاء الاصطناعي بالمعالجة/الاستجابة؛ للمطبيقات النصية (text-based).',
    },
    tps: {
      title: 'سرعة إخراج الرمز',
      explanation: 'قياس أداء LLM. عد الرموز إخراج LLM من بداية الطلب إلى اكتمال الإخراج.',
    },
  },
}

export default translation
