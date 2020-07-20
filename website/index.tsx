import fs from 'fs';
import path from 'path';
import { terser } from 'rollup-plugin-terser';
import * as rollup from 'rollup';
import * as React from 'preact';
import renderToString from 'preact-render-to-string';
// @ts-ignore
import babel from '@rollup/plugin-babel';
import resolve from '@rollup/plugin-node-resolve';
import postcss from 'postcss';
import alias from '@rollup/plugin-alias';

// @ts-ignore
import cssnano from 'cssnano';
// @ts-ignore
import autoprefixer from 'autoprefixer';
import template from './template';
import getDocInfo, { DocInfo } from './getDocInfo';
import App from './App';
import showdown from 'showdown';
const converter = new showdown.Converter();
converter.setOption('tables', true);
converter.setOption('rawHeaderId', true);

async function render() {
  // get doc info
  const functionFiles = (
    await fs.promises.readdir(path.resolve(__dirname, '../src'))
  ).filter(
    (filename) =>
      !filename.endsWith('.test.ts') &&
      filename !== 'index.ts' &&
      filename !== 'ColorError.ts'
  );

  const docs: DocInfo[] = [];
  for (const file of functionFiles) {
    try {
      const buffer = await fs.promises.readFile(
        path.resolve(__dirname, `../src/${file}`)
      );
      const contents = buffer.toString();
      docs.push(getDocInfo(contents));
    } catch (e) {
      console.warn(`Failed to create doc for ${file}. ${e.message}`);
    }
  }
  docs.sort((a, b) => a.functionName.localeCompare(b.functionName));

  // get readme markdown
  let readme = (
    await fs.promises.readFile(path.resolve(__dirname, '../README.md'))
  ).toString();

  const docsEndIndex = readme.indexOf('<!-- DOCS-END -->');
  readme = readme.substring(0, docsEndIndex);
  const readmeHtml = converter.makeHtml(readme);

  // render app
  const result = renderToString(<App docs={docs} readmeHtml={readmeHtml} />);

  // bundle code
  const extensions = ['.js', '.ts', '.tsx'];

  async function bundle(name: string) {
    const build = await rollup.rollup({
      input: require.resolve(`./${name}`),
      plugins: [
        alias({
          entries: {
            color2k: require.resolve('../src/index.ts'),
          },
        }),
        resolve({ extensions }),
        babel({
          babelrc: false,
          presets: [
            ['@babel/preset-env', { targets: '> 5%' }],
            '@babel/preset-typescript',
            '@babel/preset-react',
          ],
          babelHelpers: 'bundled',
          extensions,
        }),
        terser(),
      ],
      external: ['react', 'react-dom'],
    });
    const { output } = await build.generate({
      format: 'iife',
      name,
      globals: {
        react: 'React',
      },
    });
    if (output.length !== 1) {
      throw new Error('expected only one chunk');
    }
    const [chunk] = output;
    const { code } = chunk;
    return code;
  }

  const code = await bundle('App');

  // process css
  const rawCss = await fs.promises.readFile(
    path.resolve(__dirname, './App.css')
  );
  const { css } = await postcss([cssnano, autoprefixer]).process(rawCss, {
    from: path.resolve(__dirname, './App.css'),
  });

  // ensure build dir
  const buildFolder = path.resolve(__dirname, '../build');
  const exists = await new Promise<boolean>((resolve) => {
    fs.exists(buildFolder, resolve);
  });
  if (!exists) {
    await fs.promises.mkdir(buildFolder);
  }

  // write index.html
  await fs.promises.writeFile(
    path.resolve(buildFolder, './index.html'),
    template({ reactHtml: result, reactCode: code, css, docs, readmeHtml })
  );

  // copy static files into build
  const staticFiles = await fs.promises.readdir(
    path.resolve(__dirname, './static')
  );

  for (const staticFile of staticFiles) {
    const fileBuffer = await fs.promises.readFile(
      path.resolve(__dirname, `./static/${staticFile}`)
    );

    await fs.promises.writeFile(
      path.resolve(__dirname, `../build/${staticFile}`),
      fileBuffer
    );
  }
}

export default render;
