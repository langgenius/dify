import type { Metadata, Viewport } from "next";
import I18nServer from "./components/i18n-server";
import BrowerInitor from "./components/browser-initor";
import SentryInitor from "./components/sentry-initor";
import Topbar from "./components/base/topbar";
import { getLocaleOnServer } from "@/i18n/server";
import "./styles/globals.css";
import "./styles/markdown.scss";
import { NextUIProvider } from "@nextui-org/react";

export const metadata: Metadata = {
  title: process.env.NEXT_APP_NAME || "ChatBotX",
  description:
    "ChatbotX is an  LLM app development platform. Its intuitive interface combines AI workflow, RAG pipeline, agent capabilities, model management, observability features and more, allowing you to quickly go from prototype to production. Here's a list of the core features:",
  robots: {
    index: true,
    follow: true,
  },
  metadataBase: new URL(process.env.NEXT_PUBLIC_URL as string),
  openGraph: {
    type: "website",
    url: process.env.NEXT_PUBLIC_URL,
    images: [
      {
        url: "/og/image.png",
      },
    ],
  },
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  maximumScale: 1,
  viewportFit: "cover",
  userScalable: false,
};

const LocaleLayout = ({ children }: { children: React.ReactNode }) => {
  const locale = getLocaleOnServer();
  const BASE_URL = process.env.NEXT_PUBLIC_URL;

  return (
    <html lang={locale ?? "en"} className="h-full" data-theme="light">
      <head>
        <meta name="theme-color" content="#FFFFFF" />
        <meta name="mobile-web-app-capable" content="yes" />
        <meta name="apple-mobile-web-app-capable" content="yes" />
        <meta name="apple-mobile-web-app-status-bar-style" content="default" />
        {/* <script
          dangerouslySetInnerHTML={{
            __html: `
      window.difyChatbotConfig = { 
        token: 'U60QO9NuXuI1E8q4', 
        isDev: true  , 
        baseUrl : "${BASE_URL}" 
      }
    `,
          }}
        />
        <script
          src="https://dify.angeltools.xyz/embed.min.js"
          id="U60QO9NuXuI1E8q4"
          defer
        ></script> */}
      </head>

      <body
        className="h-full select-auto"
        data-api-prefix={process.env.NEXT_PUBLIC_API_PREFIX}
        data-pubic-api-prefix={process.env.NEXT_PUBLIC_PUBLIC_API_PREFIX}
        data-public-edition={process.env.NEXT_PUBLIC_EDITION}
        data-public-support-mail-login={
          process.env.NEXT_PUBLIC_SUPPORT_MAIL_LOGIN
        }
        data-public-sentry-dsn={process.env.NEXT_PUBLIC_SENTRY_DSN}
        data-public-maintenance-notice={
          process.env.NEXT_PUBLIC_MAINTENANCE_NOTICE
        }
        data-public-site-about={process.env.NEXT_PUBLIC_SITE_ABOUT}
      >
        <NextUIProvider>
          <Topbar />
          <BrowerInitor>
            <SentryInitor>
              <I18nServer>{children}</I18nServer>
            </SentryInitor>
          </BrowerInitor>
        </NextUIProvider>
      </body>
    </html>
  );
};

export default LocaleLayout;
