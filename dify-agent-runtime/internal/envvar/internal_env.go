package envvar

// internally used envs
// most of which are well-known ones

const (
	EnvSSLCertFile = "SSL_CERT_FILE"
)

// Well-known proxy env vars injected into job environments.
const (
	EnvHTTPProxy       = "HTTP_PROXY"
	EnvHTTPSProxy      = "HTTPS_PROXY"
	EnvHTTPProxyLower  = "http_proxy"
	EnvHTTPSProxyLower = "https_proxy"
	EnvNoProxy         = "NO_PROXY"
	EnvNoProxyLower    = "no_proxy"
)

// Well-known CA cert / trust env vars injected into job environments.
const (
	EnvRequestsCABundle = "REQUESTS_CA_BUNDLE"
	EnvNodeExtraCACerts = "NODE_EXTRA_CA_CERTS"
	EnvCURLCABundle     = "CURL_CA_BUNDLE"
	EnvGitSSLCAInfo     = "GIT_SSL_CAINFO"
	EnvPIPCert          = "PIP_CERT"
)

// Internal shellctl env vars stripped from the inherited job environment.
const (
	EnvTMUX = "TMUX"
)
