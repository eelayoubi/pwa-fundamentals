/* eslint-env node */

const extractSass = require('./extract-sass');

module.exports = function () {
  return {
    rules: [
      {
        test: /\.jsx?$/,
        exclude: /node_modules/,
        use: [
          {
            loader: 'babel-loader'
          },
          {
            loader: 'eslint-loader',
            options: {
              emitError: true
            }
          }
        ]
      },
      {
        type: 'javascript/auto',
        test: /\.(json|html)/,
        exclude: /node_modules/,
        use: [{
          loader: 'file-loader',
          options: { name: '[name].[ext]' },
        }],
      },
      {
        test: /\.scss$/,
        use: [
          'style-loader', // creates style nodes from JS strings
          'css-loader', // translates CSS into CommonJS
          {
            loader: 'sass-loader',
            options: {
              includePaths: ['node_modules/muicss/lib/sass']
            }
          }
        ]
      }
    ]
  };
};
