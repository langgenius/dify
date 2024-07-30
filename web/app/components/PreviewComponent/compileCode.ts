import * as React from 'react'
import * as recharts from 'recharts'
import * as ReactBootstrap from 'react-bootstrap'
import * as ReactIcons from 'react-icons/fa'
import * as Babel from '@babel/standalone'

const importToVariablePlugin = ({ types: t }: any) => ({
  visitor: {
    ImportDeclaration(path: any) {
      const declarations = path.node.specifiers
        .map((specifier: any) => {
          if (t.isImportDefaultSpecifier(specifier)) {
            return t.variableDeclarator(
              specifier.local,
              t.memberExpression(
                t.identifier('scope'),
                t.identifier(specifier.local.name),
              ),
            )
          }
          else if (t.isImportSpecifier(specifier)) {
            if (path.node.source.value === 'react') {
              return t.variableDeclarator(
                specifier.local,
                t.memberExpression(
                  t.memberExpression(
                    t.identifier('scope'),
                    t.identifier('React'),
                  ),
                  specifier.imported,
                ),
              )
            }
            else {
              return t.variableDeclarator(
                specifier.local,
                t.memberExpression(t.identifier('scope'), specifier.imported),
              )
            }
          }
          return null
        })
        .filter(Boolean)
      path.replaceWith(t.variableDeclaration('const', declarations))
    },
    ExportDefaultDeclaration(path: any) {
      path.replaceWith(
        t.expressionStatement(
          t.assignmentExpression(
            '=',
            t.memberExpression(
              t.identifier('exports'),
              t.identifier('default'),
            ),
            path.node.declaration,
          ),
        ),
      )
    },
  },
})

const compileCodeToComponent = async (code: string) => {
  const transpiledCode = Babel.transform(code, {
    presets: ['react'],
    plugins: [importToVariablePlugin],
  }).code

  const scope: any = {
    React: {
      ...React,
      useState: React.useState,
      useEffect: React.useEffect,
    },
    ...recharts,
    ...ReactBootstrap,
    ...ReactIcons,
  }

  const fullCode = `
        const exports = {};
        ${transpiledCode}
        return exports.default;
    `

  /* eslint-disable no-new-func */
  const evalCode = new Function('scope', fullCode)
  /* eslint-enable no-new-func */
  const ComponentToRender = evalCode(scope)

  return ComponentToRender
}

export default compileCodeToComponent
