'use client'

import React from 'react'

// ヒーローセクション
const HeroSection = () => {
  return (
    <section className="relative min-h-screen flex items-center justify-center bg-gradient-to-br from-slate-900 via-slate-800 to-slate-900">
      {/* 背景のオーバーレイパターン */}
      <div className="absolute inset-0 bg-[url('data:image/svg+xml;base64,PHN2ZyB3aWR0aD0iNjAiIGhlaWdodD0iNjAiIHZpZXdCb3g9IjAgMCA2MCA2MCIgeG1sbnM9Imh0dHA6Ly93d3cudzMub3JnLzIwMDAvc3ZnIj48ZyBmaWxsPSJub25lIiBmaWxsLXJ1bGU9ImV2ZW5vZGQiPjxnIGZpbGw9IiNmZmYiIGZpbGwtb3BhY2l0eT0iMC4wMyI+PHBhdGggZD0iTTM2IDM0djItSDI0di0yaDEyek0zNiAyNHYySDI0di0yaDEyeiIvPjwvZz48L2c+PC9zdmc+')] opacity-40"></div>

      <div className="container mx-auto px-6 py-20 text-center relative z-10">
        <p className="text-amber-400 text-sm tracking-[0.3em] uppercase mb-6 font-medium">
          Premium Photo Collection
        </p>
        <h1 className="text-5xl md:text-7xl font-bold text-white mb-6 leading-tight">
          瞬間を永遠に
          <br />
          <span className="text-transparent bg-clip-text bg-gradient-to-r from-amber-400 to-orange-500">
            残す写真集
          </span>
        </h1>
        <p className="text-xl text-slate-300 mb-12 max-w-2xl mx-auto leading-relaxed">
          プロフェッショナルが厳選した美しい写真の数々を、
          <br className="hidden md:block" />
          高品質な印刷で永遠にお手元に。
        </p>
        <div className="flex flex-col sm:flex-row gap-4 justify-center">
          <a
            href="#products"
            className="px-8 py-4 bg-gradient-to-r from-amber-500 to-orange-500 text-white font-semibold rounded-full hover:from-amber-600 hover:to-orange-600 transition-all duration-300 shadow-lg hover:shadow-amber-500/25 hover:-translate-y-1"
          >
            写真集を見る
          </a>
          <a
            href="#features"
            className="px-8 py-4 border-2 border-slate-500 text-slate-300 font-semibold rounded-full hover:border-amber-400 hover:text-amber-400 transition-all duration-300"
          >
            特徴を知る
          </a>
        </div>
      </div>

      {/* スクロールインジケーター */}
      <div className="absolute bottom-8 left-1/2 -translate-x-1/2 animate-bounce">
        <svg className="w-6 h-6 text-slate-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 14l-7 7m0 0l-7-7m7 7V3" />
        </svg>
      </div>
    </section>
  )
}

// 商品紹介セクション
const ProductsSection = () => {
  const products = [
    {
      id: 1,
      title: '都市の鼓動',
      description: '世界の大都市を巡り、その息づかいを捉えた写真集。夜景から日常まで、都市の多様な表情を収録。',
      price: '¥4,980',
      image: 'https://images.unsplash.com/photo-1519501025264-65ba15a82390?w=600&h=400&fit=crop',
      tag: 'NEW',
    },
    {
      id: 2,
      title: '静寂の自然',
      description: '手つかずの自然が織りなす神秘的な風景。森、山、海の静けさを感じる一冊。',
      price: '¥5,480',
      image: 'https://images.unsplash.com/photo-1441974231531-c6227db76b6e?w=600&h=400&fit=crop',
      tag: 'POPULAR',
    },
    {
      id: 3,
      title: '人々の物語',
      description: '世界各地で出会った人々の表情と暮らし。文化の多様性と人間の温かさを伝えるポートレート集。',
      price: '¥4,480',
      image: 'https://images.unsplash.com/photo-1529156069898-49953e39b3ac?w=600&h=400&fit=crop',
      tag: '',
    },
  ]

  return (
    <section id="products" className="py-24 bg-slate-50">
      <div className="container mx-auto px-6">
        <div className="text-center mb-16">
          <p className="text-amber-600 text-sm tracking-[0.2em] uppercase mb-4 font-medium">
            Our Collection
          </p>
          <h2 className="text-4xl md:text-5xl font-bold text-slate-900 mb-6">
            厳選された写真集
          </h2>
          <p className="text-lg text-slate-600 max-w-2xl mx-auto">
            プロフェッショナルフォトグラファーが世界中で撮影した、
            珠玉の作品をお届けします。
          </p>
        </div>

        <div className="grid md:grid-cols-2 lg:grid-cols-3 gap-8">
          {products.map(product => (
            <div
              key={product.id}
              className="group bg-white rounded-2xl overflow-hidden shadow-lg hover:shadow-2xl transition-all duration-500 hover:-translate-y-2"
            >
              <div className="relative overflow-hidden">
                <img
                  src={product.image}
                  alt={product.title}
                  className="w-full h-64 object-cover group-hover:scale-110 transition-transform duration-700"
                />
                {product.tag && (
                  <span className="absolute top-4 left-4 px-3 py-1 bg-amber-500 text-white text-xs font-bold rounded-full">
                    {product.tag}
                  </span>
                )}
              </div>
              <div className="p-6">
                <h3 className="text-2xl font-bold text-slate-900 mb-3">{product.title}</h3>
                <p className="text-slate-600 mb-4 leading-relaxed">{product.description}</p>
                <div className="flex items-center justify-between">
                  <span className="text-2xl font-bold text-amber-600">{product.price}</span>
                  <button className="px-6 py-2 bg-slate-900 text-white rounded-full hover:bg-amber-600 transition-colors duration-300">
                    詳細を見る
                  </button>
                </div>
              </div>
            </div>
          ))}
        </div>
      </div>
    </section>
  )
}

// 特徴セクション
const FeaturesSection = () => {
  const features = [
    {
      icon: (
        <svg className="w-8 h-8" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 3v4M3 5h4M6 17v4m-2-2h4m5-16l2.286 6.857L21 12l-5.714 2.143L13 21l-2.286-6.857L5 12l5.714-2.143L13 3z" />
        </svg>
      ),
      title: '最高品質の印刷',
      description: '最新の印刷技術と厳選された用紙で、写真本来の美しさを最大限に引き出します。',
    },
    {
      icon: (
        <svg className="w-8 h-8" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 6.253v13m0-13C10.832 5.477 9.246 5 7.5 5S4.168 5.477 3 6.253v13C4.168 18.477 5.754 18 7.5 18s3.332.477 4.5 1.253m0-13C13.168 5.477 14.754 5 16.5 5c1.747 0 3.332.477 4.5 1.253v13C19.832 18.477 18.247 18 16.5 18c-1.746 0-3.332.477-4.5 1.253" />
        </svg>
      ),
      title: '丁寧な製本',
      description: '職人の手による丁寧な製本で、何度開いても美しい状態を保ちます。',
    },
    {
      icon: (
        <svg className="w-8 h-8" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 9a2 2 0 012-2h.93a2 2 0 001.664-.89l.812-1.22A2 2 0 0110.07 4h3.86a2 2 0 011.664.89l.812 1.22A2 2 0 0018.07 7H19a2 2 0 012 2v9a2 2 0 01-2 2H5a2 2 0 01-2-2V9z" />
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 13a3 3 0 11-6 0 3 3 0 016 0z" />
        </svg>
      ),
      title: 'プロの厳選写真',
      description: '世界で活躍するプロフォトグラファーが厳選した、心に響く写真だけを収録。',
    },
    {
      icon: (
        <svg className="w-8 h-8" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M20 7l-8-4-8 4m16 0l-8 4m8-4v10l-8 4m0-10L4 7m8 4v10M4 7v10l8 4" />
        </svg>
      ),
      title: '特別なパッケージ',
      description: '贈り物にも最適な、高級感あふれる特別パッケージでお届けします。',
    },
  ]

  return (
    <section id="features" className="py-24 bg-white">
      <div className="container mx-auto px-6">
        <div className="text-center mb-16">
          <p className="text-amber-600 text-sm tracking-[0.2em] uppercase mb-4 font-medium">
            Why Choose Us
          </p>
          <h2 className="text-4xl md:text-5xl font-bold text-slate-900 mb-6">
            選ばれる理由
          </h2>
          <p className="text-lg text-slate-600 max-w-2xl mx-auto">
            品質にこだわり抜いた写真集を、心を込めてお届けします。
          </p>
        </div>

        <div className="grid md:grid-cols-2 lg:grid-cols-4 gap-8">
          {features.map((feature, index) => (
            <div
              key={index}
              className="text-center p-8 rounded-2xl bg-slate-50 hover:bg-gradient-to-br hover:from-amber-50 hover:to-orange-50 transition-all duration-300 group"
            >
              <div className="inline-flex items-center justify-center w-16 h-16 rounded-full bg-gradient-to-br from-amber-400 to-orange-500 text-white mb-6 group-hover:scale-110 transition-transform duration-300">
                {feature.icon}
              </div>
              <h3 className="text-xl font-bold text-slate-900 mb-4">{feature.title}</h3>
              <p className="text-slate-600 leading-relaxed">{feature.description}</p>
            </div>
          ))}
        </div>
      </div>
    </section>
  )
}

// お客様の声セクション
const TestimonialsSection = () => {
  const testimonials = [
    {
      name: '田中 美咲',
      role: '写真愛好家',
      content: '印刷の品質に驚きました。デジタルでは味わえない、紙の質感と色の深みが素晴らしいです。',
      avatar: 'https://images.unsplash.com/photo-1494790108377-be9c29b29330?w=100&h=100&fit=crop',
    },
    {
      name: '鈴木 健太',
      role: 'デザイナー',
      content: '製本の美しさ、細部へのこだわりが感じられます。何度見ても飽きない、一生の宝物です。',
      avatar: 'https://images.unsplash.com/photo-1507003211169-0a1dd7228f2d?w=100&h=100&fit=crop',
    },
    {
      name: '佐藤 由美',
      role: 'インテリアコーディネーター',
      content: 'リビングに飾っています。来客の度に話題になる、存在感のある写真集です。',
      avatar: 'https://images.unsplash.com/photo-1438761681033-6461ffad8d80?w=100&h=100&fit=crop',
    },
  ]

  return (
    <section className="py-24 bg-slate-900">
      <div className="container mx-auto px-6">
        <div className="text-center mb-16">
          <p className="text-amber-400 text-sm tracking-[0.2em] uppercase mb-4 font-medium">
            Testimonials
          </p>
          <h2 className="text-4xl md:text-5xl font-bold text-white mb-6">
            お客様の声
          </h2>
        </div>

        <div className="grid md:grid-cols-3 gap-8">
          {testimonials.map((testimonial, index) => (
            <div
              key={index}
              className="bg-slate-800 p-8 rounded-2xl border border-slate-700 hover:border-amber-500/50 transition-colors duration-300"
            >
              <div className="flex items-center mb-6">
                <img
                  src={testimonial.avatar}
                  alt={testimonial.name}
                  className="w-14 h-14 rounded-full object-cover mr-4"
                />
                <div>
                  <h4 className="text-lg font-semibold text-white">{testimonial.name}</h4>
                  <p className="text-slate-400 text-sm">{testimonial.role}</p>
                </div>
              </div>
              <p className="text-slate-300 leading-relaxed italic">"{testimonial.content}"</p>
              <div className="flex mt-4 text-amber-400">
                {[...Array(5)].map((_, i) => (
                  <svg key={i} className="w-5 h-5" fill="currentColor" viewBox="0 0 20 20">
                    <path d="M9.049 2.927c.3-.921 1.603-.921 1.902 0l1.07 3.292a1 1 0 00.95.69h3.462c.969 0 1.371 1.24.588 1.81l-2.8 2.034a1 1 0 00-.364 1.118l1.07 3.292c.3.921-.755 1.688-1.54 1.118l-2.8-2.034a1 1 0 00-1.175 0l-2.8 2.034c-.784.57-1.838-.197-1.539-1.118l1.07-3.292a1 1 0 00-.364-1.118L2.98 8.72c-.783-.57-.38-1.81.588-1.81h3.461a1 1 0 00.951-.69l1.07-3.292z" />
                  </svg>
                ))}
              </div>
            </div>
          ))}
        </div>
      </div>
    </section>
  )
}

// 価格・CTAセクション
const PricingSection = () => {
  return (
    <section id="pricing" className="py-24 bg-gradient-to-br from-amber-50 to-orange-50">
      <div className="container mx-auto px-6">
        <div className="text-center mb-16">
          <p className="text-amber-600 text-sm tracking-[0.2em] uppercase mb-4 font-medium">
            Special Offer
          </p>
          <h2 className="text-4xl md:text-5xl font-bold text-slate-900 mb-6">
            期間限定キャンペーン
          </h2>
          <p className="text-lg text-slate-600 max-w-2xl mx-auto">
            今なら全商品送料無料、さらに2冊以上のご購入で10%OFF
          </p>
        </div>

        <div className="max-w-4xl mx-auto bg-white rounded-3xl shadow-2xl overflow-hidden">
          <div className="md:flex">
            <div className="md:w-1/2 bg-gradient-to-br from-slate-900 to-slate-800 p-10 text-white">
              <h3 className="text-2xl font-bold mb-4">全コレクションセット</h3>
              <p className="text-slate-300 mb-6">
                3冊すべてをセットでお求めいただくと、特別価格でご提供いたします。
              </p>
              <div className="mb-6">
                <span className="text-slate-400 line-through text-lg">¥14,940</span>
                <span className="text-4xl font-bold text-amber-400 ml-4">¥11,980</span>
              </div>
              <ul className="space-y-3 mb-8">
                <li className="flex items-center">
                  <svg className="w-5 h-5 text-amber-400 mr-3" fill="currentColor" viewBox="0 0 20 20">
                    <path fillRule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" clipRule="evenodd" />
                  </svg>
                  <span>3冊セット（都市の鼓動・静寂の自然・人々の物語）</span>
                </li>
                <li className="flex items-center">
                  <svg className="w-5 h-5 text-amber-400 mr-3" fill="currentColor" viewBox="0 0 20 20">
                    <path fillRule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" clipRule="evenodd" />
                  </svg>
                  <span>特製コレクションボックス付き</span>
                </li>
                <li className="flex items-center">
                  <svg className="w-5 h-5 text-amber-400 mr-3" fill="currentColor" viewBox="0 0 20 20">
                    <path fillRule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" clipRule="evenodd" />
                  </svg>
                  <span>送料無料</span>
                </li>
              </ul>
              <button className="w-full py-4 bg-gradient-to-r from-amber-500 to-orange-500 text-white font-bold rounded-full hover:from-amber-600 hover:to-orange-600 transition-all duration-300">
                今すぐ購入する
              </button>
            </div>
            <div className="md:w-1/2 p-10">
              <h3 className="text-2xl font-bold text-slate-900 mb-6">単品購入</h3>
              <div className="space-y-4">
                <div className="flex items-center justify-between p-4 bg-slate-50 rounded-xl">
                  <span className="font-medium text-slate-900">都市の鼓動</span>
                  <span className="font-bold text-amber-600">¥4,980</span>
                </div>
                <div className="flex items-center justify-between p-4 bg-slate-50 rounded-xl">
                  <span className="font-medium text-slate-900">静寂の自然</span>
                  <span className="font-bold text-amber-600">¥5,480</span>
                </div>
                <div className="flex items-center justify-between p-4 bg-slate-50 rounded-xl">
                  <span className="font-medium text-slate-900">人々の物語</span>
                  <span className="font-bold text-amber-600">¥4,480</span>
                </div>
              </div>
              <p className="text-slate-500 text-sm mt-6 text-center">
                ※ 単品購入の場合、送料550円が別途かかります
              </p>
            </div>
          </div>
        </div>
      </div>
    </section>
  )
}

// フッター
const Footer = () => {
  return (
    <footer className="bg-slate-900 text-slate-400 py-16">
      <div className="container mx-auto px-6">
        <div className="grid md:grid-cols-4 gap-12 mb-12">
          <div className="md:col-span-2">
            <h3 className="text-2xl font-bold text-white mb-4">PhotoBook Gallery</h3>
            <p className="leading-relaxed mb-6">
              世界中の美しい瞬間を、高品質な写真集としてお届けします。
              プロフェッショナルの技術と情熱が詰まった一冊を、ぜひお手元に。
            </p>
            <div className="flex space-x-4">
              <a href="#" className="w-10 h-10 rounded-full bg-slate-800 flex items-center justify-center hover:bg-amber-500 transition-colors duration-300">
                <svg className="w-5 h-5" fill="currentColor" viewBox="0 0 24 24">
                  <path d="M24 4.557c-.883.392-1.832.656-2.828.775 1.017-.609 1.798-1.574 2.165-2.724-.951.564-2.005.974-3.127 1.195-.897-.957-2.178-1.555-3.594-1.555-3.179 0-5.515 2.966-4.797 6.045-4.091-.205-7.719-2.165-10.148-5.144-1.29 2.213-.669 5.108 1.523 6.574-.806-.026-1.566-.247-2.229-.616-.054 2.281 1.581 4.415 3.949 4.89-.693.188-1.452.232-2.224.084.626 1.956 2.444 3.379 4.6 3.419-2.07 1.623-4.678 2.348-7.29 2.04 2.179 1.397 4.768 2.212 7.548 2.212 9.142 0 14.307-7.721 13.995-14.646.962-.695 1.797-1.562 2.457-2.549z" />
                </svg>
              </a>
              <a href="#" className="w-10 h-10 rounded-full bg-slate-800 flex items-center justify-center hover:bg-amber-500 transition-colors duration-300">
                <svg className="w-5 h-5" fill="currentColor" viewBox="0 0 24 24">
                  <path d="M12 2.163c3.204 0 3.584.012 4.85.07 3.252.148 4.771 1.691 4.919 4.919.058 1.265.069 1.645.069 4.849 0 3.205-.012 3.584-.069 4.849-.149 3.225-1.664 4.771-4.919 4.919-1.266.058-1.644.07-4.85.07-3.204 0-3.584-.012-4.849-.07-3.26-.149-4.771-1.699-4.919-4.92-.058-1.265-.07-1.644-.07-4.849 0-3.204.013-3.583.07-4.849.149-3.227 1.664-4.771 4.919-4.919 1.266-.057 1.645-.069 4.849-.069zm0-2.163c-3.259 0-3.667.014-4.947.072-4.358.2-6.78 2.618-6.98 6.98-.059 1.281-.073 1.689-.073 4.948 0 3.259.014 3.668.072 4.948.2 4.358 2.618 6.78 6.98 6.98 1.281.058 1.689.072 4.948.072 3.259 0 3.668-.014 4.948-.072 4.354-.2 6.782-2.618 6.979-6.98.059-1.28.073-1.689.073-4.948 0-3.259-.014-3.667-.072-4.947-.196-4.354-2.617-6.78-6.979-6.98-1.281-.059-1.69-.073-4.949-.073zm0 5.838c-3.403 0-6.162 2.759-6.162 6.162s2.759 6.163 6.162 6.163 6.162-2.759 6.162-6.163c0-3.403-2.759-6.162-6.162-6.162zm0 10.162c-2.209 0-4-1.79-4-4 0-2.209 1.791-4 4-4s4 1.791 4 4c0 2.21-1.791 4-4 4zm6.406-11.845c-.796 0-1.441.645-1.441 1.44s.645 1.44 1.441 1.44c.795 0 1.439-.645 1.439-1.44s-.644-1.44-1.439-1.44z" />
                </svg>
              </a>
              <a href="#" className="w-10 h-10 rounded-full bg-slate-800 flex items-center justify-center hover:bg-amber-500 transition-colors duration-300">
                <svg className="w-5 h-5" fill="currentColor" viewBox="0 0 24 24">
                  <path d="M22.675 0h-21.35c-.732 0-1.325.593-1.325 1.325v21.351c0 .731.593 1.324 1.325 1.324h11.495v-9.294h-3.128v-3.622h3.128v-2.671c0-3.1 1.893-4.788 4.659-4.788 1.325 0 2.463.099 2.795.143v3.24l-1.918.001c-1.504 0-1.795.715-1.795 1.763v2.313h3.587l-.467 3.622h-3.12v9.293h6.116c.73 0 1.323-.593 1.323-1.325v-21.35c0-.732-.593-1.325-1.325-1.325z" />
                </svg>
              </a>
            </div>
          </div>
          <div>
            <h4 className="text-white font-semibold mb-4">リンク</h4>
            <ul className="space-y-3">
              <li><a href="#" className="hover:text-amber-400 transition-colors duration-300">会社概要</a></li>
              <li><a href="#" className="hover:text-amber-400 transition-colors duration-300">よくある質問</a></li>
              <li><a href="#" className="hover:text-amber-400 transition-colors duration-300">お問い合わせ</a></li>
              <li><a href="#" className="hover:text-amber-400 transition-colors duration-300">プライバシーポリシー</a></li>
            </ul>
          </div>
          <div>
            <h4 className="text-white font-semibold mb-4">お問い合わせ</h4>
            <ul className="space-y-3">
              <li className="flex items-center">
                <svg className="w-5 h-5 mr-3 text-amber-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 8l7.89 5.26a2 2 0 002.22 0L21 8M5 19h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z" />
                </svg>
                info@photobook.example.com
              </li>
              <li className="flex items-center">
                <svg className="w-5 h-5 mr-3 text-amber-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 5a2 2 0 012-2h3.28a1 1 0 01.948.684l1.498 4.493a1 1 0 01-.502 1.21l-2.257 1.13a11.042 11.042 0 005.516 5.516l1.13-2.257a1 1 0 011.21-.502l4.493 1.498a1 1 0 01.684.949V19a2 2 0 01-2 2h-1C9.716 21 3 14.284 3 6V5z" />
                </svg>
                03-1234-5678
              </li>
              <li className="flex items-start">
                <svg className="w-5 h-5 mr-3 text-amber-400 mt-1" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17.657 16.657L13.414 20.9a1.998 1.998 0 01-2.827 0l-4.244-4.243a8 8 0 1111.314 0z" />
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 11a3 3 0 11-6 0 3 3 0 016 0z" />
                </svg>
                <span>〒100-0001<br />東京都千代田区1-1-1</span>
              </li>
            </ul>
          </div>
        </div>
        <div className="border-t border-slate-800 pt-8 text-center">
          <p>&copy; 2024 PhotoBook Gallery. All rights reserved.</p>
        </div>
      </div>
    </footer>
  )
}

// メインページコンポーネント
export default function PhotoBookLandingPage() {
  return (
    <main className="overflow-hidden">
      <HeroSection />
      <ProductsSection />
      <FeaturesSection />
      <TestimonialsSection />
      <PricingSection />
      <Footer />
    </main>
  )
}
