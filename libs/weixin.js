// 微信API
const crypto = require('crypto');
const request = require('request');
const util = require('util');
const randomString = require('randomstring');
const httpGet = util.promisify(request.get);
function sha1(str, encoding) {
    if (!encoding) encoding = 'utf-8';
    var md5sum = crypto.createHash('sha1');
    md5sum.update(str, encoding);
    str = md5sum.digest('hex');
    return str;
}

function Weixin(options) {
    if (!(this instanceof Weixin)) return new Weixin(options);
    this.appid = options.appId;
    this.secret = options.appSecret;
}

Weixin.prototype.getToken = async function () {
    let self = this;
    if (self._token && self._token.expire < Date.now()) return self._token.token;

    let url = 'https://api.Weixin.qq.com/cgi-bin/token';
    let qs = {
        grant_type: 'client_credential',
        appid: self.appid,
        secret: self.secret
    }

    let { statusCode, body } = await httpGet({
        url: url,
        qs: qs,
        json: true
    });

    if (statusCode !== 200 || !body.access_token) throw new Error(`${statusCode} ${body.errcode}-${body.errmsg}`);

    self._token = {
        token: body.access_token,
        expire: Date.now() + (body.expire_in - 300) * 1000
    };

    return body.access_token;
}


Weixin.prototype.getJsapiTicket = async function () {
    let self = this;
    if (self._ticket && self._token.expire < Date.now()) return self._ticket.ticket;

    let url = 'https://api.Weixin.qq.com/cgi-bin/ticket/getticket';
    let token = await self.getToken();
    let qs = {
        access_token: token,
        type: 'jsapi'
    }

    let { statusCode, body } = await httpGet({
        url: url,
        qs: qs,
        json: true
    });

    if (statusCode !== 200 || body.errcode !== 0) throw new Error(`${statusCode} ${body.errcode}-${body.errmsg}`);

    self._ticket = {
        ticket: body.ticket,
        expire: Date.now() + (body.expire_in - 300) * 1000
    };

    return body.ticket;
}


Weixin.prototype.signJSSdk = async function (url) {
    let ticket = await this.getJsapiTicket();
    let noncestr = randomString.generate();
    let timestamp = parseInt(Date.now() / 1000);
    let content = `jsapi_ticket=${ticket}&noncestr=${noncestr}&timestamp=${timestamp}&url=${url}`;

    return {
        signature: sha1(content),
        noncestr,
        timestamp,
        url
    };
}

async function test(wxc) {
    let wx = new Weixin(wxc);

    let token = await wx.getToken();
    let ticket = await wx.getJsapiTicket(token);
    let signJSSdk = await wx.signJSSdk('http://www.baidu.com');
    console.log('token: %s, ticket: %s, signJSSdk: %j', token, ticket, signJSSdk);
}
// test(config.weixin).catch(err => console.error(err));

module.exports = Weixin(require('config').weixin);
