const path = require('path');
const webpack = require('webpack');
const UglifyJSPlugin = require('uglifyjs-webpack-plugin');
const pkg = require('./package.json');

const sourceDir = path.resolve(__dirname, 'src');
const buildDir = path.resolve(__dirname, 'dist');
const shimPath = path.resolve(sourceDir, 'shim.js');

function shim(regExp, path) {
    return new webpack.NormalModuleReplacementPlugin(regExp, path || shimPath);
}

module.exports = {
    stats: { warnings: false },
    mode: process.env.NODE_ENV || 'development',
    entry: path.resolve(sourceDir, 'index.js'),
    output: {
        filename: `${pkg.displayname}.min.js`,
        path: buildDir
    },
    plugins: [
        // replace CSS
        shim(/@jupyterlab\/.*\.css/, path.resolve(sourceDir, `${pkg.displayname}.css`)),
        // shim unused packages – source: https://github.com/minrk/thebelab
        shim(/moment/),
        shim(/codemirror\/keymap\/vim/),
        shim(/codemirror\/addon\/search/),
        shim(/@phosphor\/coreutils\/lib\/random/),
        shim(/@phosphor\/widgets\/lib\/(commandpalette|box|dock|grid|menu|scroll|split|stacked|tab).*/),
        shim(/@phosphor\/(dragdrop|commands).*/),
        shim(/@jupyterlab\/apputils/),
        shim(/@jupyterlab\/codeeditor\/lib\/jsoneditor/),
        shim(/@jupyterlab\/coreutils\/lib\/(time|settingregistry|.*menu.*)/),
        shim(/@jupyterlab\/services\/lib\/(session|contents|terminal)\/.*/),
        new UglifyJSPlugin({ cache: true, parallel: true, sourceMap: false }),
        new webpack.BannerPlugin(`${pkg.name}\n${pkg.description}\n\n@author ${pkg.author}\n@version ${pkg.version}\n@license ${pkg.license}`)
    ],
    module: {
        rules: [
            {
                test: /\.js$/,
                loader: 'babel-loader',
                query: { presets: ['env'] }
            },
            {
                test: /\.css$/,
                use: [
                    {
                        loader: 'style-loader',
                        options: {
                            singleton: true,
                            insertAt: 'top',
                            attrs: { 'data-added-by': pkg.displayname }
                        }
                    },
                    {
                        loader: 'css-loader'
                    }
                ]
            }
        ]
    }
}
