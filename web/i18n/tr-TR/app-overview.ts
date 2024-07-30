const translation = {
  welcome: {
    firstStepTip: 'Başlamak için,',
    enterKeyTip: 'OpenAI API Anahtarınızı aşağıya girin',
    getKeyTip: 'OpenAI kontrol panelinden API Anahtarınızı alın',
    placeholder: 'OpenAI API Anahtarınız (örn. sk-xxxx)',
  },
  apiKeyInfo: {
    cloud: {
      trial: {
        title: '{{providerName}} deneme kotasını kullanıyorsunuz.',
        description: 'Deneme kotası test amaçlarınız için sağlanmıştır. Deneme kotası tükenmeden önce, lütfen kendi model sağlayıcınızı kurun veya ek kota satın alın.',
      },
      exhausted: {
        title: 'Deneme kotanız tükendi, lütfen API Anahtarınızı ayarlayın.',
        description: 'Deneme kotanızı tükettiniz. Lütfen kendi model sağlayıcınızı kurun veya ek kota satın alın.',
      },
    },
    selfHost: {
      title: {
        row1: 'Başlamak için,',
        row2: 'önce model sağlayıcınızı ayarlayın.',
      },
    },
    callTimes: 'Çağrı sayısı',
    usedToken: 'Kullanılan token',
    setAPIBtn: 'Model sağlayıcı kurulumuna git',
    tryCloud: 'Veya ücretsiz kota ile Dify\'ın bulut versiyonunu deneyin',
  },
  overview: {
    title: 'Genel Bakış',
    appInfo: {
      explanation: 'Kullanıma hazır AI Web Uygulaması',
      accessibleAddress: 'Genel URL',
      preview: 'Önizleme',
      regenerate: 'Yeniden oluştur',
      regenerateNotice: 'Genel URL\'yi yeniden oluşturmak istiyor musunuz?',
      preUseReminder: 'Lütfen devam etmeden önce Web Uygulamasını etkinleştirin.',
      settings: {
        entry: 'Ayarlar',
        title: 'Web Uygulaması Ayarları',
        webName: 'Web Uygulaması Adı',
        webDesc: 'Web Uygulaması Açıklaması',
        webDescTip: 'Bu metin istemci tarafında görüntülenecek ve uygulamanın nasıl kullanılacağı konusunda temel rehberlik sağlayacaktır',
        webDescPlaceholder: 'Web Uygulamasının açıklamasını girin',
        language: 'Dil',
        workflow: {
          title: 'İş Akışı Adımları',
          show: 'Göster',
          hide: 'Gizle',
        },
        chatColorTheme: 'Sohbet renk teması',
        chatColorThemeDesc: 'Sohbet botunun renk temasını ayarlayın',
        chatColorThemeInverted: 'Ters çevrilmiş',
        invalidHexMessage: 'Geçersiz onaltılık değer',
        more: {
          entry: 'Daha fazla ayar göster',
          copyright: 'Telif hakkı',
          copyRightPlaceholder: 'Yazar veya kuruluşun adını girin',
          privacyPolicy: 'Gizlilik Politikası',
          privacyPolicyPlaceholder: 'Gizlilik politikası bağlantısını girin',
          privacyPolicyTip: 'Ziyaretçilerin uygulamanın topladığı verileri anlamasına yardımcı olur, Dify\'ın <privacyPolicyLink>Gizlilik Politikası</privacyPolicyLink>\'na bakın.',
          customDisclaimer: 'Özel Sorumluluk Reddi',
          customDisclaimerPlaceholder: 'Özel sorumluluk reddi metnini girin',
          customDisclaimerTip: 'Özel sorumluluk reddi metni istemci tarafında görüntülenecek ve uygulama hakkında ek bilgi sağlayacaktır',
        },
      },
      embedded: {
        entry: 'Gömülü',
        title: 'Web sitesine gömme',
        explanation: 'Sohbet uygulamasını web sitenize gömmek için yöntemi seçin',
        iframe: 'Sohbet uygulamasını web sitenizin herhangi bir yerine eklemek için, bu iframe\'i html kodunuza ekleyin.',
        scripts: 'Web sitenizin sağ alt köşesine bir sohbet uygulaması eklemek için bu kodu html\'nize ekleyin.',
        chromePlugin: 'Dify Chatbot Chrome Uzantısını Yükle',
        copied: 'Kopyalandı',
        copy: 'Kopyala',
      },
      qrcode: {
        title: 'Bağlantı QR Kodu',
        scan: 'Paylaşmak için Tarayın',
        download: 'QR Kodunu İndir',
      },
      customize: {
        way: 'yol',
        entry: 'Özelleştir',
        title: 'AI Web Uygulamasını Özelleştir',
        explanation: 'Web Uygulamasının ön yüzünü senaryonuza ve stil ihtiyaçlarınıza uyacak şekilde özelleştirebilirsiniz.',
        way1: {
          name: 'İstemci kodunu fork edin, değiştirin ve Vercel\'e dağıtın (önerilen)',
          step1: 'İstemci kodunu fork edin ve değiştirin',
          step1Tip: 'Kaynak kodunu GitHub hesabınıza fork etmek ve kodu değiştirmek için buraya tıklayın',
          step1Operation: 'Dify-WebClient',
          step2: 'Vercel\'e dağıtın',
          step2Tip: 'Depoyu Vercel\'e aktarmak ve dağıtmak için buraya tıklayın',
          step2Operation: 'Depoyu içe aktar',
          step3: 'Ortam değişkenlerini yapılandırın',
          step3Tip: 'Vercel\'de aşağıdaki ortam değişkenlerini ekleyin',
        },
        way2: {
          name: 'API\'yi çağırmak için istemci tarafı kod yazın ve bir sunucuya dağıtın',
          operation: 'Dokümantasyon',
        },
      },
    },
    apiInfo: {
      title: 'Backend Servis API\'si',
      explanation: 'Uygulamanıza kolayca entegre edilir',
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
      explanation: 'Günlük AI etkileşim sayısı; komut mühendisliği/hata ayıklama hariç.',
    },
    activeUsers: {
      title: 'Aktif Kullanıcılar',
      explanation: 'AI ile soru-cevap yapan benzersiz kullanıcılar; komut mühendisliği/hata ayıklama hariç.',
    },
    tokenUsage: {
      title: 'Token Kullanımı',
      explanation: 'Uygulama için dil modelinin günlük token kullanımını yansıtır, maliyet kontrolü amaçları için kullanışlıdır.',
      consumed: 'Tüketilen',
    },
    avgSessionInteractions: {
      title: 'Ortalama Oturum Etkileşimleri',
      explanation: 'Sürekli kullanıcı-AI iletişim sayısı; konuşma tabanlı uygulamalar için.',
    },
    avgUserInteractions: {
      title: 'Ortalama Kullanıcı Etkileşimleri',
      explanation: 'Kullanıcıların günlük kullanım sıklığını yansıtır. Bu metrik kullanıcı bağlılığını yansıtır.',
    },
    userSatisfactionRate: {
      title: 'Kullanıcı Memnuniyet Oranı',
      explanation: '1.000 mesaj başına beğeni sayısı. Bu, kullanıcıların yüksek memnuniyet duyduğu cevapların oranını gösterir.',
    },
    avgResponseTime: {
      title: 'Ortalama Yanıt Süresi',
      explanation: 'AI\'nin işlemesi/yanıt vermesi için geçen süre (ms); metin tabanlı uygulamalar için.',
    },
    tps: {
      title: 'Token Çıkış Hızı',
      explanation: 'LLM\'nin performansını ölçün. İsteğin başlangıcından çıktının tamamlanmasına kadar LLM\'nin Token çıkış hızını sayın.',
    },
  },
}

export default translation
