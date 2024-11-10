package coderuntime

type Python3TemplateTransformer struct {
	*BaseTemplateTransformer
}

func NewPython3TemplateTransformer() *Python3TemplateTransformer {
	t := &Python3TemplateTransformer{}
	t.BaseTemplateTransformer = NewBaseTemplateTransformer(t)
	return t
}

func (p *Python3TemplateTransformer) GetRunnerScript() string {
	return `
# declare main function
{{code}}

import json
from base64 import b64decode

# decode and prepare input dict
inputs_obj = json.loads(b64decode('{{inputs}}').decode('utf-8'))

# execute main function
output_obj = main(**inputs_obj)

# convert output to json and print
output_json = json.dumps(output_obj, indent=4)
result = f'''<<RESULT>>{output_json}<<RESULT>>'''
print(result)
	`
}
