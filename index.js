#!/usr/bin/env node

const crypto = require('crypto');
const fs = require('fs');
const http = require('http');
const path = require('path');
const querystring = require('querystring');
const urlParse = require('url').parse;

const nunjucks = require('nunjucks');
const recrawler = require('recrawler');
const request = require('request');
const static = require('node-static');

const rootDir = path.join(__dirname, 'public');
const cacheDir = path.join(rootDir, '.cache');
const host = process.env.TUNNELRUN_FLICKR_HOST || process.env.HOST || '0.0.0.0';
const port = process.env.TUNNELRUN_FLICKR_PORT || process.env.PORT || 7000;
const nodeEnv = process.env.NODE_ENV || 'development';

const baseUrl = nodeEnv === 'production' ? 'https://flickr.tunnel.run' : `http://${host}:${port}`;

try {
  fs.mkdirSync(cacheDir);
} catch (e) {
}

const nunjucksEnv = new nunjucks.Environment(new nunjucks.FileSystemLoader('templates'));

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET',
  'Access-Control-Allow-Headers': 'Origin, X-Requested-With, Content-Type, Accept, Range'
};

const staticServer = new static.Server(rootDir, {
  headers: corsHeaders
});

const server = http.createServer((req, res) => {
  // Example URL formats:
  // - https://www.flickr.com/photos/hamburgerjung/34539117106
  // - https://www.flickr.com/photos/hamburgerjung/34539117106/
  // - https://www.flickr.com/photos/hamburgerjung/34539117106/in/pool-equirectangular
  // - https://www.flickr.com/photos/hamburgerjung/34539117106/in/pool-equirectangular/
  let flickrUrl = req.url.substr(req.url.indexOf('?') + 1);
  let matches = flickrUrl.match(/.*\/([^\/]+)\/(\d+)/i);
  let photoUser;
  let photoId;
  let flickrDownloadUrl;

  if (matches) {
    photoUser = matches[1];
    photoId = parseInt(matches[2], 10);
    flickrDownloadUrl = 'https://www.flickr.com/photos/' + photoUser + '/' + photoId + '/sizes/o/';
  }

  const reqUrl = urlParse(req.url);
  const reqPathname = reqUrl.pathname;
  const reqQuery = querystring.parse((reqUrl.search || '').substr(1));

  let pageUrl;
  let page = null;
  let manifest = null;

  if (reqPathname.endsWith('vr.html')) {
    pageUrl = req.url.replace(/\/vr.html$/i, '');
    page = 'vr';
  } else if (reqPathname.endsWith('manifest.webmanifest')) {
    pageUrl = req.url.replace(/\/manifest.webmanifest$/i, '');
    page = 'manifest';
  }

  if (page) {
    manifest = {
      lang: reqQuery.lang || 'en',
      dir: reqQuery.dir || 'ltr',
      name: reqQuery.name || (flickrDownloadUrl ? '360° Panorama' : 'TunnelRun'),
      description: reqQuery.description || (flickrDownloadUrl ? '360° Panorama' : 'Proxy images from Flickr'),
      display: reqQuery.display || 'fullscreen',
      start_url: reqQuery.start_url || (baseUrl + pageUrl + '/vr.html'),
      scope: reqQuery.scope || (baseUrl + pageUrl),
      icons: [
        {
          src: baseUrl + '/icon.svg',
          type: 'image/svg',
          sizes: '142x142'
        },
        {
          src: baseUrl + '/icon.png',
          type: 'image/png',
          sizes: '252x252'
        }
      ]
    };

    if (flickrDownloadUrl) {
      manifest.screenshots = [
        {
          src: baseUrl + pageUrl + '.jpg',
          type: 'image/jpeg'
        }
      ];
    }
  }

  if (page === 'vr') {
    let templateCtx = {
      page: manifest
    };

    nunjucksEnv.render('vr.njk', templateCtx, (err, nunjucksRes) => {
      if (err) {
        return console.log(err);
      }

      Object.keys(corsHeaders).forEach(key => {
        res.setHeader(key, corsHeaders[key]);
      });

      res.writeHead(200, {'Content-Type': 'text/html; charset=utf-8'});
      res.write(nunjucksRes.toString());
      res.end();
    });
    return;
  } else if (page === 'manifest') {
    res.writeHead(200, {'Content-Type': 'application/manifest+json; charset=utf-8'});
    res.write(JSON.stringify(manifest));
    res.end();
    return;
  }

  if (!photoUser || !photoId) {
    staticServer.serve(req, res);
    return;
  }

  if (photoUser && photoId) {
    const hash = crypto.createHash('sha1').update(flickrDownloadUrl).digest('hex');
    const hashPath = hash + '.jpg';
    const hashUrl = '/.cache/' + hashPath;
    const fn = path.join(cacheDir, hashPath);

    fs.stat(fn, (err, stats) => {
      if (!err && stats.isFile()) {
        req.url = hashUrl;
        // Read from file.
        staticServer.serve(req, res);
        return;
      }

      // Fetch from network.
      recrawler(flickrDownloadUrl).then($ => {
        $('#allsizes-photo img[src]').each(function () {
          const url = $(this).attr('src');
          request(url)
            .pipe(fs.createWriteStream(fn))
            .on('finish', () => {
              req.url = hashUrl;
              staticServer.serve(req, res);
            });
        });
      });
    });
  }
}).listen(port, host, () => {
  console.log(`[${nodeEnv}] Listening on http://${host}:${port}`);
});
