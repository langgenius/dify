const translation = {
  welcome: {
    firstStepTip: 'Başlamak için,',
    enterKeyTip: 'aşağıya OpenAI API Anahtarınızı girin',
    getKeyTip: 'OpenAI kontrol panelinden API Anahtarınızı alın',
    placeholder: 'API Anahtarınız (ör. sk-xxxx)',
  },
  apiKeyInfo: {
    cloud: {
      trial: {
        title: '{{providerName}} deneme kotasını kullanıyorsunuz.',
        description: 'Deneme kotası, test amaçlarınız için sağlanmıştır. Deneme kotası bitmeden önce kendi model sağlayıcınızı ayarlayın veya ek kota satın alın.',
      },
      exhausted: {
        title: 'Deneme kotanızı kullandınız, lütfen API Anahtarınızı ayarlayın.',
        description: 'Deneme kotanızı bitirdiniz. Lütfen kendi model sağlayıcınızı ayarlayın veya ek kota satın alın.',
      },
    },
    selfHost: {
      title: {
        row1: 'Başlamak için,',
        row2: 'model sağlayıcınızı ayarlayın.',
      },
    },
    callTimes: 'Çağrı süresi',
    usedToken: 'Kullanılan token',
    setAPIBtn: 'Model sağlayıcısını ayarlamaya git',
    tryCloud: 'Veya Dify\'nin bulut sürümünü ücretsiz kotayla deneyin',
  },
  overview: {
    title: 'Genel Bakış',
    appInfo: {
      explanation: 'Kullanıma hazır AI WebApp',
      accessibleAddress: 'Genel URL',
      preview: 'Önizleme',
      regenerate: 'Yeniden Oluştur',
      regenerateNotice: 'Genel URL\'yi yeniden oluşturmak istiyor musunuz?',
      preUseReminder: 'Devam etmeden önce WebApp\'i etkinleştirin.',
      settings: {
        entry: 'Ayarlar',
        title: 'WebApp Ayarları',
        webName: 'WebApp İsmi',
        webDesc: 'WebApp Açıklaması',
        webDescTip: 'Bu metin, uygulamanın nasıl kullanılacağına dair temel açıklamalar sağlar ve istemci tarafında görüntülenir',
        webDescPlaceholder: 'WebApp\'in açıklamasını girin',
        language: 'Dil',
        workflow: {
          title: 'Workflow Adımları',
          show: 'Göster',
          hide: 'Gizle',
          showDesc: 'WebApp\'te iş akışı ayrıntılarını gösterme veya gizleme',
          subTitle: 'İş Akışı Detayları',
        },
        chatColorTheme: 'Sohbet renk teması',
        chatColorThemeDesc: 'Sohbet botunun renk temasını ayarlayın',
        chatColorThemeInverted: 'Tersine çevrilmiş',
        invalidHexMessage: 'Geçersiz hex değeri',
        more: {
          entry: 'Daha fazla ayarı göster',
          copyright: 'Telif Hakkı',
          copyRightPlaceholder: 'Yazarın veya kuruluşun adını girin',
          privacyPolicy: 'Gizlilik Politikası',
          privacyPolicyPlaceholder: 'Gizlilik politikası bağlantısını girin',
          privacyPolicyTip: 'Ziyaretçilerin uygulamanın topladığı verileri anlamalarına yardımcı olur, Dify\'nin <privacyPolicyLink>Gizlilik Politikası</privacyPolicyLink>\'na bakın.',
          customDisclaimer: 'Özel İfşa',
          customDisclaimerPlaceholder: 'Özel ifşa metnini girin',
          customDisclaimerTip: 'Özel ifşa metni istemci tarafında görüntülenecek ve uygulama hakkında ek bilgiler sağlayacak',
        },
        sso: {
          title: 'WebApp SSO\'su',
          tooltip: 'WebApp SSO\'yu etkinleştirmek için yöneticiyle iletişime geçin',
          label: 'SSO Kimlik Doğrulaması',
          description: 'Tüm kullanıcıların WebApp\'i kullanmadan önce SSO ile oturum açmaları gerekir',
        },
      },
      embedded: {
        entry: 'Gömülü',
        title: 'Siteye Yerleştir',
        explanation: 'Sohbet uygulamasını web sitenize yerleştirmenin yollarını seçin',
        iframe: 'Sohbet uygulamasını web sitenizin herhangi bir yerine eklemek için bu iframe\'i HTML kodunuza ekleyin.',
        scripts: 'Sohbet uygulamasını web sitenizin sağ alt köşesine eklemek için bu kodu HTML\'e ekleyin.',
        chromePlugin: 'Dify Chatbot Chrome Eklentisini Yükleyin',
        copied: 'Kopyalandı',
        copy: 'Kopyala',
      },
      qrcode: {
        title: 'Bağlantı QR Kodu',
        scan: 'Paylaşmak İçin Taramak',
        download: 'QR Kodu İndir',
      },
      customize: {
        way: 'yol',
        entry: 'Özelleştir',
        title: 'AI WebApp\'i Özelleştirin',
        explanation: 'Web Uygulamasının ön yüzünü senaryo ve stil ihtiyaçlarınıza uygun şekilde özelleştirebilirsiniz.',
        way1: {
          name: 'İstemci kodunu forklayarak değiştirin ve Vercel\'e dağıtın (önerilen)',
          step1: 'İstemci kodunu forklayarak değiştirin',
          step1Tip: 'Kaynak kodunu GitHub hesabınıza forklayarak değiştirmek için buraya tıklayın',
          step1Operation: 'Dify-WebClient',
          step2: 'Vercel\'e dağıtın',
          step2Tip: 'Depoyu Vercel\'e içe aktarmak ve dağıtmak için buraya tıklayın',
          step2Operation: 'Depo içe aktar',
          step3: 'Çevresel değişkenleri yapılandırın',
          step3Tip: 'Vercel\'de aşağıdaki çevresel değişkenleri ekleyin',
        },
        way2: {
          name: 'İstemci kodunu yazarak API\'yi çağırın ve bir sunucuya dağıtın',
          operation: 'Dokümantasyon',
        },
      },
    },
    apiInfo: {
      title: 'Arka Uç Servis API\'si',
      explanation: 'Kolayca uygulamanıza entegre edin',
      accessibleAddress: 'Servis API Uç Noktası',
      doc: 'API Referansı',
    },
    status: {
      running: 'Hizmette',
      disable: 'Devre Dışı',
    },
  },
  analysis: {
    title: 'Analiz',
    ms: 'ms',
    tokenPS: 'Token/s',
    totalMessages: {
      title: 'Toplam Mesajlar',
      explanation: 'Günlük AI etkileşimi sayısı.',
    },
    totalConversations: {
      title: 'Toplam Konuşmalar',
      explanation: 'Günlük AI konuşmaları sayısı; prompt mühendisliği/hata ayıklama hariç.',
    },
    activeUsers: {
      title: 'Aktif Kullanıcılar',
      explanation: 'AI ile Soru-Cevap etkileşiminde bulunan benzersiz kullanıcılar; prompt mühendisliği/hata ayıklama hariç.',
    },
    tokenUsage: {
      title: 'Token Kullanımı',
      explanation: 'Uygulama için dil modelinin günlük token kullanımını yansıtır, maliyet kontrolü amacıyla faydalıdır.',
      consumed: 'Tüketilen',
    },
    avgSessionInteractions: {
      title: 'Ort. Oturum Etkileşimleri',
      explanation: 'Sohbete dayalı uygulamalar için sürekli kullanıcı-AI iletişim sayısı.',
    },
    avgUserInteractions: {
      title: 'Ort. Kullanıcı Etkileşimleri',
      explanation: 'Kullanıcıların günlük kullanım sıklığını yansıtır. Bu metrik, kullanıcı bağlılığını yansıtır.',
    },
    userSatisfactionRate: {
      title: 'Kullanıcı Memnuniyet Oranı',
      explanation: 'Her 1.000 mesajda alınan beğeni sayısı. Bu, kullanıcıların çok memnun olduğu cevapların oranını gösterir.',
    },
    avgResponseTime: {
      title: 'Ort. Yanıt Süresi',
      explanation: 'Metin tabanlı uygulamalar için AI\'ın işlem/yanıt süresi (ms).',
    },
    tps: {
      title: 'Token Çıktı Hızı',
      explanation: 'LLM\'nin performansını ölçün. İstekten çıktının tamamlanmasına kadar LLM\'nin Token çıktı hızını sayın.',
    },
  },
}

export default translation
