#!/usr/bin/env node

const crypto = require('crypto');
const fs = require('fs');
const http = require('http');
const path = require('path');
const urlParse = require('url').parse;

const recrawler = require('recrawler');
const request = require('request');
const static = require('node-static');

const cacheDir = path.join(__dirname, '.cache');
const port = process.env.PORT || 7000;
const host = process.env.HOST || '0.0.0.0';

// https://www.flickr.com/photos/hamburgerjung/34539117106/in/pool-equirectangular/

try {
  fs.mkdirSync(cacheDir);
} catch (e) {
}

var staticServer = new static.Server(cacheDir);

const server = http.createServer((req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Request-Method', '*');
  res.setHeader('Access-Control-Allow-Methods', 'OPTIONS, GET');
  if (req.headers.origin) {
    res.setHeader('Access-Control-Allow-Headers', req.headers.origin);
  }
  if (req.method === 'OPTIONS') {
    res.writeHead(200);
    res.end();
    return;
  }

  if (!req.url.includes('?')) {
    staticServer.serve(req, res);
    return;
  }

  let flickrUrl = req.url.substr(req.url.indexOf('?') + 1);
  let matches = flickrUrl.match(/flickr.com.+photos\/([^\/]+)\/([^\/]+)/i);
  let photoUser;
  let photoId;
  if (matches) {
    photoUser = matches[1];
    photoId = parseInt(matches[2], 10);
  }
  if (photoUser && photoId) {
    const flickrDownloadUrl = 'https://www.flickr.com/photos/' + photoUser + '/' + photoId + '/sizes/o/';
    var hash = crypto.createHash('sha1').update(flickrDownloadUrl).digest('hex');
    var hashPath = hash + '.jpg';
    var hashUrl = '/' + hashPath;
    var fn = path.join(__dirname, '.cache', hashPath);
    fs.stat(fn, function (err, stats) {
      if (!err && stats.isFile()) {
        req.url = hashUrl;
        console.log('reading from file', req.url);
        staticServer.serve(req, res);
        return;
      }

      console.log('fetching from network');
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
  console.log(`Listening on http://${host}:${port}`);
});
