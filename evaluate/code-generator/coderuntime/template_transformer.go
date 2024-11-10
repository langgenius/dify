package coderuntime

import (
	"bytes"
	"encoding/base64"
	"encoding/json"
	"strings"
)

type TemplateTransformer interface {
	TransformCaller(code string, inputs map[string]interface{}) (string, string, error)
	GetRunnerScript() string
	GetPreloadScript() string
}

type BaseTemplateTransformer struct {
	CodePlaceholder   string
	InputsPlaceholder string
	ResultTag         string
	transformer       TemplateTransformer
}

func NewBaseTemplateTransformer(t TemplateTransformer) *BaseTemplateTransformer {
	return &BaseTemplateTransformer{
		CodePlaceholder:   "{{code}}",
		InputsPlaceholder: "{{inputs}}",
		ResultTag:         "<<RESULT>>",
		transformer:       t,
	}
}

func (t *BaseTemplateTransformer) GetRunnerScript() string {
	return ""
}

func (t *BaseTemplateTransformer) GetPreloadScript() string {
	return ""
}

func (t *BaseTemplateTransformer) TransformCaller(code string, inputs map[string]interface{}) (string, string, error) {
	inputsJSON, err := json.Marshal(inputs)
	if err != nil {
		return "", "", err
	}

	var buf bytes.Buffer
	encoder := json.NewEncoder(&buf)
	encoder.SetEscapeHTML(false)
	if err := encoder.Encode(inputs); err != nil {
		return "", "", err
	}
	inputsJSON = bytes.TrimSpace(buf.Bytes()) // 末尾の改行を削除

	inputsBase64 := base64.StdEncoding.EncodeToString(inputsJSON)

	runnerScript := t.transformer.GetRunnerScript()
	runnerScript = strings.ReplaceAll(runnerScript, t.CodePlaceholder, code)
	runnerScript = strings.ReplaceAll(runnerScript, t.InputsPlaceholder, inputsBase64)

	preloadScript := t.GetPreloadScript()

	return runnerScript, preloadScript, nil
}
