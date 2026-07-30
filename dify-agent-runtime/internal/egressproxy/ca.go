package egressproxy

import (
	"crypto/rand"
	"crypto/rsa"
	"crypto/x509"
	"crypto/x509/pkix"
	"encoding/pem"
	"fmt"
	"math/big"
	"os"
	"os/exec"
	"path/filepath"
	"time"
)

// CAFiles holds the paths to the generated CA certificate and key.
type CAFiles struct {
	CertPath string
	KeyPath  string
}

// GenerateCA creates a self-signed CA certificate and private key in dir.
// The CA is used by the MITM proxy to generate per-host TLS certificates.
// Files are created with restricted permissions (0600 for key, 0644 for cert).
func GenerateCA(dir string) (*CAFiles, error) {
	if err := os.MkdirAll(dir, 0700); err != nil {
		return nil, fmt.Errorf("egressproxy: mkdir %s: %w", dir, err)
	}

	key, err := rsa.GenerateKey(rand.Reader, 2048)
	if err != nil {
		return nil, fmt.Errorf("egressproxy: generate CA key: %w", err)
	}

	serialNumber, err := rand.Int(rand.Reader, new(big.Int).Lsh(big.NewInt(1), 128))
	if err != nil {
		return nil, fmt.Errorf("egressproxy: generate serial: %w", err)
	}

	template := &x509.Certificate{
		SerialNumber: serialNumber,
		Subject: pkix.Name{
			Organization: []string{"Dify Agent Runtime"},
			CommonName:   "Dify Agent Credential Proxy CA",
		},
		NotBefore:             time.Now().Add(-1 * time.Hour),
		NotAfter:              time.Now().Add(10 * 365 * 24 * time.Hour),
		KeyUsage:              x509.KeyUsageCertSign | x509.KeyUsageCRLSign,
		BasicConstraintsValid: true,
		IsCA:                  true,
		MaxPathLen:            0,
		MaxPathLenZero:        true,
	}

	certDER, err := x509.CreateCertificate(rand.Reader, template, template, &key.PublicKey, key)
	if err != nil {
		return nil, fmt.Errorf("egressproxy: create CA cert: %w", err)
	}

	certPath := filepath.Join(dir, "ca.crt")
	keyPath := filepath.Join(dir, "ca.key")

	// Write certificate (world-readable so agent processes can trust it).
	certPEM := pem.EncodeToMemory(&pem.Block{Type: "CERTIFICATE", Bytes: certDER})
	if err := os.WriteFile(certPath, certPEM, 0644); err != nil {
		return nil, fmt.Errorf("egressproxy: write CA cert: %w", err)
	}

	// Write private key as RSA PKCS#1 (restricted).
	// tls.X509KeyPair (used by goproxy) supports both RSA and EC keys, but we
	// stick to RSA here for compatibility with existing deployments.
	keyPEM := pem.EncodeToMemory(&pem.Block{
		Type:  "RSA PRIVATE KEY",
		Bytes: x509.MarshalPKCS1PrivateKey(key),
	})
	if err := os.WriteFile(keyPath, keyPEM, 0600); err != nil {
		return nil, fmt.Errorf("egressproxy: write CA key: %w", err)
	}

	return &CAFiles{CertPath: certPath, KeyPath: keyPath}, nil
}

// systemTrustAnchorPath is where the CA cert is copied for
// update-ca-certificates to pick up. Debian/Ubuntu-based images (see
// docker/Dockerfile) scan this directory for additional trust anchors.
const systemTrustAnchorPath = "/usr/local/share/ca-certificates/dify-agent-egress-proxy-ca.crt"

// InstallSystemTrust copies the CA certificate at certPath into the system
// trust anchors directory and runs update-ca-certificates, so tools that
// don't honor SSL_CERT_FILE/CURL_CA_BUNDLE/etc. (apt-get, wget, ...) also
// trust it. This requires write access to systemTrustAnchorPath's directory
// and /etc/ssl/certs, which docker/Dockerfile grants to the non-root `dify`
// user at build time; update-ca-certificates itself performs no privileged
// syscalls, only filesystem writes.
//
// Failures here are non-fatal: callers should log and continue, since the
// per-tool env vars set by Service.EgressProxyEnv remain a working fallback
// for most jobs even if system-wide trust installation fails (e.g. on
// images that haven't granted the necessary permissions).
func InstallSystemTrust(certPath string) error {
	certPEM, err := os.ReadFile(certPath)
	if err != nil {
		return fmt.Errorf("egressproxy: read CA cert: %w", err)
	}
	if err := os.WriteFile(systemTrustAnchorPath, certPEM, 0644); err != nil {
		return fmt.Errorf("egressproxy: write system trust anchor: %w", err)
	}
	cmd := exec.Command("update-ca-certificates")
	if out, err := cmd.CombinedOutput(); err != nil {
		return fmt.Errorf("egressproxy: update-ca-certificates: %w (output: %s)", err, out)
	}
	return nil
}
