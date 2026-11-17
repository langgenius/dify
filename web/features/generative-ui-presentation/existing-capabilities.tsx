'use client'

import { Fragment } from '@revealjs/react'
import { useTranslation } from '#i18n'

const chartTemplate = [
  '```echarts',
  '{',
  '  "xAxis": {',
  '    "type": "category",',
  '    "data": {{ labels | tojson }}',
  '  },',
  '  "yAxis": { "type": "value" },',
  '  "series": [{',
  '    "type": "bar",',
  '    "data": {{ values | tojson }}',
  '  }]',
  '}',
  '```',
].join('\n')

export function ExistingCapabilities() {
  const { t } = useTranslation(['presentation', 'common'])
  const formTemplate = [
    '<form data-format="json">',
    `  <label for="feedback">${t(($) => $['threshold.formField'])}</label>`,
    '  <input type="text"',
    '         name="feedback" />',
    '  <button type="submit">',
    `    ${t(($) => $['operation.submit'], { ns: 'common' })}`,
    '  </button>',
    '</form>',
  ].join('\n')

  return (
    <>
      <h2>{t(($) => $['threshold.title'])}</h2>
      <p className="slide-lead">{t(($) => $['threshold.subtitle'])}</p>
      <Fragment asChild index={0} animation="fade-up">
        <div className="threshold-configuration">
          <p>{t(($) => $['threshold.contract'])}</p>
          <div className="threshold-node">
            <span aria-hidden="true" className="i-ri-code-box-line" />
            <div>
              <strong>{t(($) => $['threshold.templateNode'])}</strong>
              <div className="threshold-bindings">
                <code>labels ← {t(($) => $['threshold.upstream'])}.labels</code>
                <code>values ← {t(($) => $['threshold.upstream'])}.values</code>
              </div>
            </div>
          </div>
          <span aria-hidden="true" className="threshold-connection i-ri-arrow-right-line" />
          <div className="threshold-node">
            <span aria-hidden="true" className="i-ri-chat-1-line" />
            <div>
              <strong>{t(($) => $['threshold.answerNode'])}</strong>
              <code>{t(($) => $['threshold.templateNode'])}.output</code>
            </div>
          </div>
        </div>
      </Fragment>
      <div className="threshold-examples">
        <Fragment asChild index={1} animation="fade-up">
          <article className="threshold-example">
            <div className="threshold-example-heading">
              <span className="threshold-example-number">01</span>
              <h3>{t(($) => $['threshold.template'])}</h3>
              <span className="threshold-example-language">ECharts / Jinja2</span>
            </div>
            <pre className="threshold-code">
              <code>{chartTemplate}</code>
            </pre>
            <p className="threshold-example-caption">{t(($) => $['threshold.dataBinding'])}</p>
          </article>
        </Fragment>
        <Fragment asChild index={2} animation="fade-up">
          <article className="threshold-example">
            <div className="threshold-example-heading">
              <span className="threshold-example-number">02</span>
              <h3>{t(($) => $['threshold.interaction'])}</h3>
              <span className="threshold-example-language">HTML / JSON</span>
            </div>
            <div className="threshold-form-example">
              <pre className="threshold-code">
                <code>{formTemplate}</code>
              </pre>
              <div className="threshold-submission">
                <span aria-hidden="true" className="i-ri-arrow-down-line" />
                <samp>{'{"feedback":"..."}'}</samp>
              </div>
            </div>
            <p className="threshold-example-caption">{t(($) => $['threshold.formSubmission'])}</p>
          </article>
        </Fragment>
      </div>
      <Fragment asChild index={3} animation="fade-up">
        <p className="threshold-conclusion">
          <span aria-hidden="true" className="i-ri-tools-line" />
          {t(($) => $['threshold.withUI'])}
        </p>
      </Fragment>
    </>
  )
}
