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

  if (reqPathname.endsWith('vr.html')) {
    const pageUrl = req.url.replace('/vr.html', '');

    let templateCtx = {
      page: {
        name: reqQuery.name || '360° Panorama',
        description: reqQuery.description || '360° Panorama',
        url: baseUrl + pageUrl,
        pano: {
          src: baseUrl + pageUrl + '.jpg'
        }
      }
    };

    nunjucksEnv.render('vr.njk', templateCtx, (err, nunjucksRes) => {
      if (err) {
        return console.log(err);
      }

      Object.keys(corsHeaders).forEach(key => {
        res.setHeader(key, corsHeaders[key]);
      });

      res.writeHead(200, {'Content-Type': 'text/html'});
      res.write(nunjucksRes.toString());
      res.end();
    });
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

    fs.stat(fn, function (err, stats) {
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
            .on('finish', function () {
              req.url = hashUrl;
              staticServer.serve(req, res);
            });
        });
      });
    });
  }
}).listen(port, host, function () {
  console.log(`[${nodeEnv}] Listening on http://${host}:${port}`);
});
