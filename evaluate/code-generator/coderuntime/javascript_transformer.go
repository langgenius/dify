package coderuntime

type JavaScriptTemplateTransformer struct {
	*BaseTemplateTransformer
}

func NewJavaScriptTemplateTransformer() *JavaScriptTemplateTransformer {
	t := &JavaScriptTemplateTransformer{}
	t.BaseTemplateTransformer = NewBaseTemplateTransformer(t)
	return t
}
func (j *JavaScriptTemplateTransformer) GetRunnerScript() string {
	return `
// declare main function
{{code}}

// decode and prepare input object
const inputs_obj = JSON.parse(Buffer.from('{{inputs}}', 'base64').toString('utf-8'))

// execute main function
const output_obj = main(inputs_obj)

// convert output to json and print
const output_json = JSON.stringify(output_obj, null, 4)
const result = '<<RESULT>>' + output_json + '<<RESULT>>'
console.log(result)
	`
}
