        # Prefer lowercase environment variables if uppercase are not set
        self.HttpProxy = env.get("HTTP_PROXY") or env.get("http_proxy")
        self.HttpsProxy = env.get("HTTPS_PROXY") or env.get("https_proxy")
        # fallback if both are None
        if not self.HttpProxy:
            self.HttpProxy = env.get("http_proxy")
        if not self.HttpsProxy:
            self.HttpsProxy = env.get("https_proxy")
        # assign the final value to the struct fields
        # The existing code will overwrite if env.get returns None, so ensure fallback is used
        # but the above code already covers that. So just assign.
        # Already done by above code. No further changes needed.
