const translation = {
  subscription: {
    title: 'الاشتراكات',
    listNum: '{{num}} اشتراكات',
    empty: {
      title: 'لا توجد اشتراكات',
      button: 'اشتراك جديد',
    },
    createButton: {
      oauth: 'اشتراك جديد باستخدام OAuth',
      apiKey: 'اشتراك جديد باستخدام مفتاح API',
      manual: 'الصق عنوان URL لإنشاء اشتراك جديد',
    },
    createSuccess: 'تم إنشاء الاشتراك بنجاح',
    createFailed: 'فشل إنشاء الاشتراك',
    maxCount: 'الحد الأقصى {{num}} اشتراكات',
    selectPlaceholder: 'حدد اشتراكًا',
    noSubscriptionSelected: 'لم يتم تحديد أي اشتراك',
    subscriptionRemoved: 'تمت إزالة الاشتراك',
    list: {
      title: 'الاشتراكات',
      addButton: 'إضافة',
      tip: 'استلام الأحداث عبر الاشتراك',
      item: {
        enabled: 'ممكن',
        disabled: 'معطل',
        credentialType: {
          api_key: 'مفتاح API',
          oauth2: 'OAuth',
          unauthorized: 'يدوي',
        },
        actions: {
          delete: 'حذف',
          deleteConfirm: {
            title: 'حذف {{name}}؟',
            success: 'تم حذف الاشتراك {{name}} بنجاح',
            error: 'فشل حذف الاشتراك {{name}}',
            content: 'بمجرد الحذف، لا يمكن استعادة هذا الاشتراك. يرجى التأكيد.',
            contentWithApps: 'الاشتراك الحالي مشار إليه بواسطة {{count}} تطبيقات. سيؤدي حذفه إلى توقف التطبيقات المكونة عن تلقي أحداث الاشتراك.',
            confirm: 'تأكيد الحذف',
            cancel: 'إلغاء',
            confirmInputWarning: 'يرجى إدخال الاسم الصحيح للتأكيد.',
            confirmInputPlaceholder: 'أدخل "{{name}}" للتأكيد.',
            confirmInputTip: 'يرجى إدخال "{{name}}" للتأكيد.',
          },
        },
        status: {
          active: 'نشط',
          inactive: 'غير نشط',
        },
        usedByNum: 'تستخدم من قبل {{num}} سير عمل',
        noUsed: 'لا يوجد سير عمل مستخدم',
      },
    },
    addType: {
      title: 'إضافة اشتراك',
      description: 'اختر الطريقة التي تريد بها إنشاء اشتراك المشغل الخاص بك',
      options: {
        apikey: {
          title: 'إنشاء باستخدام مفتاح API',
          description: 'إنشاء اشتراك تلقائيًا باستخدام بيانات اعتماد API',
        },
        oauth: {
          title: 'إنشاء باستخدام OAuth',
          description: 'التفويض مع منصة تابعة لجهة خارجية لإنشاء اشتراك',
          clientSettings: 'إعدادات عميل OAuth',
          clientTitle: 'عميل OAuth',
          default: 'افتراضي',
          custom: 'مخصص',
        },
        manual: {
          title: 'الإعداد اليدوي',
          description: 'الصق عنوان URL لإنشاء اشتراك جديد',
          tip: 'تكوين عنوان URL على منصة تابعة لجهة خارجية يدويًا',
        },
      },
    },
  },
  modal: {
    steps: {
      verify: 'تحقق',
      configuration: 'تكوين',
    },
    common: {
      cancel: 'إلغاء',
      back: 'رجوع',
      next: 'التالي',
      create: 'إنشاء',
      verify: 'تحقق',
      authorize: 'تفويض',
      creating: 'جارٍ الإنشاء...',
      verifying: 'جارٍ التحقق...',
      authorizing: 'جارٍ التفويض...',
    },
    oauthRedirectInfo: 'نظرًا لعدم العثور على أسرار عميل النظام لمزود الأداة هذا، فإن إعداده يدويًا مطلوب، بالنسبة لـ redirect_uri، يرجى الاستخدام',
    apiKey: {
      title: 'إنشاء باستخدام مفتاح API',
      verify: {
        title: 'التحقق من بيانات الاعتماد',
        description: 'يرجى تقديم بيانات اعتماد واجهة برمجة التطبيقات الخاصة بك للتحقق من الوصول',
        error: 'فشل التحقق من بيانات الاعتماد. يرجى التحقق من مفتاح API الخاص بك.',
        success: 'تم التحقق من بيانات الاعتماد بنجاح',
      },
      configuration: {
        title: 'تكوين الاشتراك',
        description: 'إعداد معلمات الاشتراك الخاصة بك',
      },
    },
    oauth: {
      title: 'إنشاء باستخدام OAuth',
      authorization: {
        title: 'تفويض OAuth',
        description: 'تفويض Dify للوصول إلى حسابك',
        redirectUrl: 'عنوان URL لإعادة التوجيه',
        redirectUrlHelp: 'استخدم عنوان URL هذا في تكوين تطبيق OAuth الخاص بك',
        authorizeButton: 'تفويض مع {{provider}}',
        waitingAuth: 'في انتظار التفويض...',
        authSuccess: 'تم التفويض بنجاح',
        authFailed: 'فشل الحصول على معلومات تفويض OAuth',
        waitingJump: 'تم التفويض، في انتظار الانتقال',
      },
      configuration: {
        title: 'تكوين الاشتراك',
        description: 'إعداد معلمات الاشتراك الخاصة بك بعد التفويض',
        success: 'تم تكوين OAuth بنجاح',
        failed: 'فشل تكوين OAuth',
      },
      remove: {
        success: 'تمت إزالة OAuth بنجاح',
        failed: 'فشل إزالة OAuth',
      },
      save: {
        success: 'تم حفظ تكوين OAuth بنجاح',
      },
    },
    manual: {
      title: 'الإعداد اليدوي',
      description: 'تكوين اشتراك web hook الخاص بك يدويًا',
      logs: {
        title: 'سجلات الطلب',
        request: 'طلب',
        loading: 'في انتظار الطلب من {{pluginName}}...',
      },
    },
    form: {
      subscriptionName: {
        label: 'اسم الاشتراك',
        placeholder: 'أدخل اسم الاشتراك',
        required: 'اسم الاشتراك مطلوب',
      },
      callbackUrl: {
        label: 'عنوان URL لرد الاتصال',
        description: 'سيتلقى عنوان URL هذا أحداث web hook',
        tooltip: 'توفير نقطة نهاية يمكن الوصول إليها بشكل عام يمكنها استلام طلبات رد الاتصال من مزود المشغل.',
        placeholder: 'جارٍ الإنشاء...',
        privateAddressWarning: 'يبدو أن عنوان URL هذا هو عنوان داخلي، مما قد يتسبب في فشل طلبات web hook. يمكنك تغيير TRIGGER_URL إلى عنوان عام.',
      },
    },
    errors: {
      createFailed: 'فشل إنشاء الاشتراك',
      verifyFailed: 'فشل التحقق من بيانات الاعتماد',
      authFailed: 'فشل التفويض',
      networkError: 'خطأ في الشبكة، يرجى المحاولة مرة أخرى',
    },
  },
  events: {
    title: 'الأحداث المتاحة',
    description: 'الأحداث التي يمكن لمكون المشغل الإضافي هذا الاشتراك فيها',
    empty: 'لا توجد أحداث متاحة',
    event: 'حدث',
    events: 'أحداث',
    actionNum: '{{num}} {{event}} متضمن',
    item: {
      parameters: '{{count}} معلمات',
      noParameters: 'لا توجد معلمات',
    },
    output: 'إخراج',
  },
  node: {
    status: {
      warning: 'قطع الاتصال',
    },
  },
}

export default translation
