package mcpserver

import (
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"os"
	"sort"
	"strings"
	"time"
)

// GitHubDeviceCodeResponse represents the device flow initiation payload.
type GitHubDeviceCodeResponse struct {
	DeviceCode      string `json:"device_code"`
	UserCode        string `json:"user_code"`
	VerificationURI string `json:"verification_uri"`
	ExpiresIn       int    `json:"expires_in"`
	Interval        int    `json:"interval"`
}

// GitHubTokenResponse represents the final OAuth token payload.
type GitHubTokenResponse struct {
	AccessToken string `json:"access_token,omitempty"`
	TokenType   string `json:"token_type,omitempty"`
	Scope       string `json:"scope,omitempty"`
	Error       string `json:"error,omitempty"`
}

// Official GitHub CLI / Copilot public client ID for Device Code authentication.
const GitHubCopilotClientID = "Iv1.b507a08c87ecfe81"

// StartGitHubDeviceOAuth initiates GitHub Device Code OAuth flow.
func StartGitHubDeviceOAuth(ctx context.Context) (*GitHubDeviceCodeResponse, error) {
	data := url.Values{}
	data.Set("client_id", GitHubCopilotClientID)
	data.Set("scope", "read:user")

	req, err := http.NewRequestWithContext(ctx, http.MethodPost, "https://github.com/login/device/code", strings.NewReader(data.Encode()))
	if err != nil {
		return nil, err
	}
	req.Header.Set("Content-Type", "application/x-www-form-urlencoded")
	req.Header.Set("Accept", "application/json")

	client := &http.Client{Timeout: 15 * time.Second}
	resp, err := client.Do(req)
	if err != nil {
		return nil, fmt.Errorf("device flow request failed: %w", err)
	}
	defer resp.Body.Close()

	body, _ := io.ReadAll(resp.Body)
	if resp.StatusCode != http.StatusOK {
		return nil, fmt.Errorf("GitHub returned HTTP %d: %s", resp.StatusCode, string(body))
	}

	var res GitHubDeviceCodeResponse
	if err := json.Unmarshal(body, &res); err != nil {
		return nil, fmt.Errorf("failed to parse GitHub device response: %w", err)
	}

	return &res, nil
}

// PollGitHubDeviceOAuth polls GitHub to check if user authorized the device code.
func PollGitHubDeviceOAuth(ctx context.Context, deviceCode string) (*GitHubTokenResponse, error) {
	data := url.Values{}
	data.Set("client_id", GitHubCopilotClientID)
	data.Set("device_code", deviceCode)
	data.Set("grant_type", "urn:ietf:params:oauth:grant-type:device_code")

	req, err := http.NewRequestWithContext(ctx, http.MethodPost, "https://github.com/login/oauth/access_token", strings.NewReader(data.Encode()))
	if err != nil {
		return nil, err
	}
	req.Header.Set("Content-Type", "application/x-www-form-urlencoded")
	req.Header.Set("Accept", "application/json")

	client := &http.Client{Timeout: 15 * time.Second}
	resp, err := client.Do(req)
	if err != nil {
		return nil, fmt.Errorf("token exchange request failed: %w", err)
	}
	defer resp.Body.Close()

	body, _ := io.ReadAll(resp.Body)
	var res GitHubTokenResponse
	if err := json.Unmarshal(body, &res); err != nil {
		return nil, fmt.Errorf("failed to parse token response: %w", err)
	}

	return &res, nil
}

// FetchProviderModels queries the remote AI catalog endpoint and returns filtered, ranked chat models.
func FetchProviderModels(ctx context.Context, provider, apiKey, baseURL string) ([]string, string, error) {
	client := &http.Client{Timeout: 15 * time.Second}

	switch provider {
	case "gemini":
		effectiveKey := apiKey
		if effectiveKey == "" {
			effectiveKey = os.Getenv("GEMINI_API_KEY")
			if effectiveKey == "" {
				effectiveKey = os.Getenv("GOOGLE_API_KEY")
			}
		}
		if effectiveKey == "" {
			// Return standard prioritized Gemini models if unauthenticated
			return []string{"gemini-2.5-flash", "gemini-1.5-pro", "gemini-1.5-flash"}, "gemini-2.5-flash", nil
		}

		u := fmt.Sprintf("https://generativelanguage.googleapis.com/v1beta/models?key=%s", url.QueryEscape(effectiveKey))
		req, err := http.NewRequestWithContext(ctx, http.MethodGet, u, nil)
		if err != nil {
			return nil, "", err
		}

		resp, err := client.Do(req)
		if err != nil || resp.StatusCode != http.StatusOK {
			return []string{"gemini-2.5-flash", "gemini-1.5-pro", "gemini-1.5-flash"}, "gemini-2.5-flash", nil
		}
		defer resp.Body.Close()

		var geminiResp struct {
			Models []struct {
				Name                       string   `json:"name"`
				SupportedGenerationMethods []string `json:"supportedGenerationMethods"`
			} `json:"models"`
		}

		if err := json.NewDecoder(resp.Body).Decode(&geminiResp); err != nil {
			return []string{"gemini-2.5-flash", "gemini-1.5-pro", "gemini-1.5-flash"}, "gemini-2.5-flash", nil
		}

		var models []string
		for _, m := range geminiResp.Models {
			// Clean "models/" prefix
			cleanName := strings.TrimPrefix(m.Name, "models/")
			// Filter for chat / generateContent models
			hasGen := false
			for _, method := range m.SupportedGenerationMethods {
				if method == "generateContent" {
					hasGen = true
					break
				}
			}
			if hasGen && !strings.Contains(cleanName, "embedding") && !strings.Contains(cleanName, "aqa") {
				models = append(models, cleanName)
			}
		}

		if len(models) == 0 {
			models = []string{"gemini-2.5-flash", "gemini-1.5-pro", "gemini-1.5-flash"}
		}

		// Rank flagship models first
		sort.SliceStable(models, func(i, j int) bool {
			return modelScore(models[i]) > modelScore(models[j])
		})

		return models, models[0], nil

	case "claude":
		// Anthropic models
		models := []string{
			"claude-3-5-sonnet-20241022",
			"claude-3-5-haiku-20241022",
			"claude-3-opus-20240229",
		}
		return models, models[0], nil

	default:
		// OpenAI / Custom / Ollama / DeepSeek
		bURL := baseURL
		if bURL == "" {
			if provider == "custom" {
				bURL = "https://api.deepseek.com/v1"
			} else {
				bURL = "https://api.openai.com/v1"
			}
		}
		bURL = strings.TrimRight(bURL, "/")

		// 1. Check if Ollama endpoint
		if strings.Contains(bURL, "11434") {
			ollamaURL := fmt.Sprintf("%s/api/tags", bURL)
			req, _ := http.NewRequestWithContext(ctx, http.MethodGet, ollamaURL, nil)
			if resp, err := client.Do(req); err == nil && resp.StatusCode == http.StatusOK {
				defer resp.Body.Close()
				var oResp struct {
					Models []struct {
						Name string `json:"name"`
					} `json:"models"`
				}
				if err := json.NewDecoder(resp.Body).Decode(&oResp); err == nil && len(oResp.Models) > 0 {
					var oModels []string
					for _, om := range oResp.Models {
						oModels = append(oModels, om.Name)
					}
					return oModels, oModels[0], nil
				}
			}
		}

		// 2. OpenAI /v1/models endpoint
		modelsURL := fmt.Sprintf("%s/models", bURL)
		req, err := http.NewRequestWithContext(ctx, http.MethodGet, modelsURL, nil)
		if err != nil {
			return defaultOpenAiModels(provider)
		}

		effectiveKey := apiKey
		if effectiveKey == "" {
			effectiveKey = os.Getenv("OPENAI_API_KEY")
			if effectiveKey == "" {
				effectiveKey = os.Getenv("DEEPSEEK_API_KEY")
			}
		}
		if effectiveKey != "" {
			req.Header.Set("Authorization", "Bearer "+effectiveKey)
		}

		resp, err := client.Do(req)
		if err != nil || resp.StatusCode != http.StatusOK {
			return defaultOpenAiModels(provider)
		}
		defer resp.Body.Close()

		var openAiResp struct {
			Data []struct {
				ID string `json:"id"`
			} `json:"data"`
		}

		if err := json.NewDecoder(resp.Body).Decode(&openAiResp); err != nil {
			return defaultOpenAiModels(provider)
		}

		var filtered []string
		for _, m := range openAiResp.Data {
			idLower := strings.ToLower(m.ID)
			// Filter out non-chat models (audio, tts, dall-e, babbage, davinci, embeddings)
			if strings.Contains(idLower, "embed") ||
				strings.Contains(idLower, "tts") ||
				strings.Contains(idLower, "whisper") ||
				strings.Contains(idLower, "dall-e") ||
				strings.Contains(idLower, "realtime") ||
				strings.Contains(idLower, "moderation") {
				continue
			}
			filtered = append(filtered, m.ID)
		}

		if len(filtered) == 0 {
			return defaultOpenAiModels(provider)
		}

		// Rank flagship models first
		sort.SliceStable(filtered, func(i, j int) bool {
			return modelScore(filtered[i]) > modelScore(filtered[j])
		})

		return filtered, filtered[0], nil
	}
}

func defaultOpenAiModels(provider string) ([]string, string, error) {
	if provider == "custom" {
		models := []string{"deepseek-chat", "deepseek-coder", "llama3.3:70b", "qwen2.5-coder:32b"}
		return models, models[0], nil
	}
	models := []string{"gpt-4o", "o1-mini", "gpt-4o-mini", "gpt-4-turbo"}
	return models, models[0], nil
}

// modelScore assigns priority rank to well-known flagship models so they appear at the top.
func modelScore(name string) int {
	n := strings.ToLower(name)
	switch {
	case strings.Contains(n, "2.5-flash"):
		return 100
	case strings.Contains(n, "1.5-pro"):
		return 90
	case strings.Contains(n, "1.5-flash"):
		return 80
	case strings.Contains(n, "gpt-4o") && !strings.Contains(n, "mini"):
		return 100
	case strings.Contains(n, "o1"):
		return 95
	case strings.Contains(n, "gpt-4o-mini"):
		return 85
	case strings.Contains(n, "sonnet"):
		return 100
	case strings.Contains(n, "deepseek-chat"):
		return 100
	case strings.Contains(n, "deepseek-coder"):
		return 95
	default:
		return 10
	}
}
