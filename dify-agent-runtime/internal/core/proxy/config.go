package proxy

import (
	"fmt"
	"os"

	"gopkg.in/yaml.v3"
)

// LoadConfig reads and validates a providers.yaml file.
func LoadConfig(path string) (*InjectionConfig, error) {
	data, err := os.ReadFile(path)
	if err != nil {
		return nil, fmt.Errorf("providers.yaml: %w", err)
	}

	// First pass: unmarshal into a map so we can set provider names.
	var raw struct {
		Providers map[string]struct {
			Secrets []SecretMapping `yaml:"secrets"`
		} `yaml:"providers"`
	}
	if err := yaml.Unmarshal(data, &raw); err != nil {
		return nil, fmt.Errorf("providers.yaml: %w", err)
	}

	cfg := &InjectionConfig{
		Providers: make(map[string]ProviderProfile, len(raw.Providers)),
	}
	for name, rawProfile := range raw.Providers {
		cfg.Providers[name] = ProviderProfile{
			Name:    name,
			Secrets: rawProfile.Secrets,
		}
	}

	if err := cfg.Validate(); err != nil {
		return nil, fmt.Errorf("providers.yaml: %w", err)
	}

	return cfg, nil
}

// BuildEnv returns the environment variables to expose to the agent.
// Real secrets are replaced with placeholder values.
func (c *InjectionConfig) BuildEnv() []string {
	var env []string
	for _, p := range c.Providers {
		for _, s := range p.Secrets {
			env = append(env, fmt.Sprintf("%s=%s", s.Env, Placeholder(p.Name, s.Env)))
		}
	}
	return env
}
