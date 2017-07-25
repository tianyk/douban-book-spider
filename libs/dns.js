const cache = require('lru-cache')({
    maxAge: 1000 * 60 * 5
});
const dns = require('dnscache')({
    enable: true,
    max: 500,
    maxAge: 1000 * 60 * 60,
    cache: function () {
        this.set = (key, value, cb) => cb(null, cache.set(key, value));
        this.get = (key, cb) => cb(null, cache.get(key));
    }
});

exports = module.exports = dns;