const fs = require('fs');
const path = require('path');
// 默认config会去加载./config目录
process.env.NODE_CONFIG_DIR = path.join(__dirname, 'config');
// 修改运行目录 强制为执行文件所在文件夹
if (__dirname === '/__enclose_io_memfs__') process.chdir(path.dirname(process.argv[0]));
else process.chdir(path.dirname(process.argv[1]));
const cheerio = require('cheerio');
const config = require('config');
const debug = require('debug')('douban_book_spider');
const htmlparser = require('htmlparser2');
const is = require('is-type-of');
const _ = require('lodash');
const request = require('request');
const url = require('url');
const util = require('util');
const write = require('write');
const Log = require('log');
const dns = require('./libs/dns');
const read = util.promisify(fs.readFile);

const logFileStream = fs.createWriteStream(path.join(process.cwd(), 'main.log'), { flags: 'a' });
const logger = new Log('info', logFileStream);

const HEADERS = {
    'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8',
    'Accept-Encoding': 'gzip, deflate, sdch',
    'Accept-Language': 'zh-CN,zh;q=0.8',
    'Cache-Control': 'no-cache',
    'Connection': 'keep-alive',
    'Pragma': 'no-cache',
    'Referer': 'https://book.douban.com/',
    'Upgrade-Insecure-Requests': '1',
    'User-Agent': 'Mozilla/5.0 (Windows NT 6.2; WOW64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/46.0.2490.86 Safari/537.36'
};
const jar = request.jar();
// https://book.douban.com/tag/?view=type&icn=index-sorttags-all

function parallel(tasks, limit) {
    let _task = [];
    for (let i = 0; i < tasks.length; i += limit)
        _task.push(tasks.slice(i, i + limit));
    return _task;
}

function delay(time) {
    return new Promise(function (reslove, reject) {
        setTimeout(function () {
            reslove();
        }, time);
    })
}

function isStandardHtml(html) {
    let validBody = false, validResponse = true;
    let parser = new htmlparser.Parser({
        onopentagname: (name) => { if (name === 'body') validBody = true },
        ontext: (text) => { if (text === '400 Bad Request') validResponse = false },
        onerror: () => { },
    });
    parser.parseComplete(html);
    return validBody && validResponse;
}

function ParseError(msg, cause) {
    let message = msg, stack;
    if (msg instanceof Error) {
        message = msg.message;
        stack = msg.stack;
    }
    Error.captureStackTrace(this, this.constructor);
    this.name = this.constructor.name;
    this.message = message;
    if (stack) this.originStack = stack;
    this.cause = cause;
}
util.inherits(ParseError, Error);

function SpiderError(msg, cause) {
    let message = msg, stack;
    if (msg instanceof Error) {
        message = msg.message;
        stack = msg.stack;
    }
    Error.captureStackTrace(this, this.constructor);
    this.name = this.constructor.name;
    this.message = message;
    if (stack) this.originStack = stack;
    this.cause = cause;
}
util.inherits(SpiderError, Error);

function Base64() {
    if (!(this instanceof Base64)) return new Base64();
}

Base64.prototype.encode = function (content) {
    let buf = Buffer.from(content);
    return buf.toString('base64');
}

Base64.prototype.decode = function (content) {
    let buf = Buffer.from(content, 'base64');
    return buf.toString();
}

// const base64 = Base64();

function Parse(pattern) {
    if (!(this instanceof Parse)) return new Parse(pattern);
    if (!is.regExp(pattern) && !is.string(pattern)) throw new Error(
        `Parse pattern should be a regExp or string. [${pattern}]`);

    this.pattern = pattern;
    this.request = request.defaults({
        headers: HEADERS,
        keepAlive: true,
        lookup: dns.lookup.bind(dns),
        gzip: true,
        timeout: 60 * 1000,
    });
    this.session = request.defaults({
        jar: jar,
        headers: HEADERS,
        keepAlive: true,
        lookup: dns.lookup.bind(dns),
        gzip: true,
        timeout: 60 * 1000,
    });
    this.dir = '.tmp';
    this.base64 = new Base64();
}

Parse.prototype.match = function (source) {
    if (is.regExp(this.pattern)) {
        return this.pattern.test(source);
    } else {
        return this.pattern === source;
    }
}

Parse.prototype.parse = async function (html) {
    debug('parse start');
    let ret = await this._parse(html);
    ret.url = url;
    debug('parse done');
    return ret;
}

Parse.prototype._parse = async function (html) {
    throw new Error('_parse() is not implemented');
}

Parse.prototype.snapshoot = async function (uri, headers = {}) {
    let uriObj = url.parse(uri);
    let dest = path.join(this.dir, 'html', uriObj.host, uriObj.pathname, 'index.html');
    let request = this.request;
    let get = util.promisify(request.get);

    let { statusCode, body } = await get(uri, { headers: _.merge(HEADERS, headers) });
    if (statusCode !== 200) {
        let err = new Error(`${statusCode}`);
        err.cause = body;
        throw err;
    }

    await write(dest, body);
    return body;
}

Parse.prototype.download = async function (url, dest, headers = {}) {
    // let dest = path.join(this.dir, this.base64.encode(url), path.extname(url));
    await download(url, dest, {
        headers: _.merge(HEADERS, headers)
    });
}

// Parse
function DoubanTagIndex() {
    if (!this instanceof DoubanTagIndex) return new DoubanTagIndex();
    Parse.call(this, /^https:\/\/book.douban.com\/tag\/(\?.*)?$/);
}

util.inherits(DoubanTagIndex, Parse);

DoubanTagIndex.prototype._parse = async function (html) {
    let $ = cheerio.load(html);
    let links = [];
    $('table.tagCol td a').each((_, elm) => { links.push('https://book.douban.com' + $(elm).attr('href')) });
    debug('links: %j', links);
    return {
        links
    };
}

function DoubanTagPage() {
    if (!this instanceof DoubanTagPage) return new DoubanTagPage();
    // /^https:\/\/book.douban.com\/tag\/[^\?#]+(\?.*)?/
    // /^https:\/\/book.douban.com\/tag\/[%A-Z0-9\u4e00-\u9fa5]+(\?.*)?$/
    Parse.call(this, /^https:\/\/book.douban.com\/tag\/[^\?#]+(\?.*)?/);
}

util.inherits(DoubanTagPage, Parse);

DoubanTagPage.prototype._parse = async function (html) {
    let $ = cheerio.load(html);
    let links = [];
    $('div.pic a.nbg').each((_, elm) => { links.push($(elm).attr('href')) });
    $('div.movie_show dt a').each((_, elm) => { links.push($(elm).attr('href')) });
    $('div.tags-list a').each((_, elm) => { links.push('https://book.douban.com' + $(elm).attr('href')) });
    $('div#subject_list div.paginator a').each((_, elm) => { links.push('https://book.douban.com' + $(elm).attr('href')) });
    $('div.aside ul.bs li a').each((_, elm) => { links.push($(elm).attr('href')) });
    debug('links: %j', links);
    return {
        links
    };
}

function DoubanBookPage() {
    if (!this instanceof DoubanBookPage) return new DoubanBookPage();
    Parse.call(this, /^https:\/\/book.douban.com\/subject\/\d+\/(\?#.*)?/);
}

util.inherits(DoubanBookPage, Parse);

DoubanBookPage.prototype._parse = async function (html) {
    let $ = cheerio.load(html);
    let $subject = $('div.subject');
    let $rating = $('div#interest_sectl');
    let $relatedInfo = $('div.related_info');
    let $tagsSection = $('div#db-tags-section');
    let $recSection = $('div#db-rec-section');

    let $image = $subject.find('div#mainpic a.nbg');
    let $bookInfo = $subject.find('div#info');
    let title = $image.attr('title');
    let image = $image.attr('href');
    // 图书基本信息
    let bookInfo = $bookInfo.html().split('<br>').map(html => {
        return $(html).text().replace(/\s/g, '').split(':');
    }).reduce((bookInfo, info) => {
        if (info.length < 2) return bookInfo;
        if (info[0] === '译者') bookInfo[info[0]] = info.slice(1).join(' ').replace(/\//g, ',');
        else bookInfo[info[0]] = info.slice(1).join(' ');
        return bookInfo;
    }, {});
    // let author = $bookInfo.children('span.pl').eq(0).next('a').text().replace(/\s/g, '');
    let seriesId = $bookInfo.children('span.pl').filter((_, el) => {
        return $(el).text() === '丛书:';
    }).next('a').attr('href');
    if (seriesId && seriesId.match(/(\d+)/)) seriesId = seriesId.match(/(\d+)/)[0];

    // let bookInfo = $bookInfo.text().match(/([^\s]+:\s+[^\s]+)+/g);
    // bookInfo = bookInfo.map(info => {
    //     return info.split(':').map(s => s.trim());
    // }).reduce((bookInfo, info) => {
    //     bookInfo[info[0]] = info[1];
    //     return bookInfo;
    // }, {});

    let { '作者': author, '出版社': publisher, '出版年': pubdate, '页数': pages, '定价': price, '装帧': binding, 'ISBN': isbn, '副标题': subtitle, '译者': translator, '丛书': seriesTitle, '原作名': originTitle } = bookInfo;

    // 评分
    let ratingAverage = $rating.find('.rating_num').text().trim();
    let ratingNumRaters = $rating.find('.rating_people').children('span').text().trim();

    // 内容简介
    let summary = $relatedInfo.children('div.indent').eq(0).text();
    // 作者简介
    let authorIntro = $relatedInfo.children('div.indent').eq(1).text();
    // 目录
    let catalog = $relatedInfo.children('div.indent').eq(3).text();

    // 标签
    let tags = $tagsSection.find('div.indent span').map((_, el) => $(el).text().trim()).get();

    // 也喜欢
    let links = $recSection.find('.content dt a').map((_, el) => $(el).attr('href')).get();
    debug('links: %j', links);

    return {
        links,
        book: {
            title,
            originTitle,
            author,
            translator,
            publisher,
            pubdate,
            pages,
            price,
            binding,
            isbn,
            subtitle,
            seriesId,
            seriesTitle,
            rating: {
                max: 10,
                numRaters: ratingNumRaters,
                average: ratingAverage,
                min: 0
            },
            summary,
            authorIntro,
            catalog,
            tags
        }
    };
}

// let dobuanTag = new DoubanBookPage();
// https://book.douban.com/subject/26575679/
// https://book.douban.com/subject/25945442/
// dobuanTag.parse('https://book.douban.com/subject/25945442/').then(console.log).catch(console.warn);

function Spider(options) {
    this.pool = require('mysql2/promise').createPool(options.mysql);
    this.parses = options.parses;
    this.request = request.defaults({
        headers: HEADERS,
        keepAlive: true,
        lookup: dns.lookup.bind(dns),
        gzip: true,
        timeout: 60 * 1000,
    });
    this.session = request.defaults({
        jar: jar,
        headers: HEADERS,
        keepAlive: true,
        lookup: dns.lookup.bind(dns),
        gzip: true,
        timeout: 60 * 1000,
    });
    this.dir = '.tmp';
    this.base64 = new Base64();
}

Spider.prototype.parse = async function (url, options = {}) {
    // 进一步封装 把parse后（成功/失败）的逻辑抽取出来
    try {
        return await this._parse(url, options);
    } catch (err) {
        this.pool.query('update links set cause = ?, html = ?, state = ? where link = ?', [`${err.name}: ${err.message}\n${err.stack}\n${err.originStack || ''}`, err.cause, 'failed', url]);
        throw err;
    }
}

Spider.prototype._parse = async function (url, options = {}) {
    debug('Spider.parse start. %s', url);
    let self = this;
    let { parses, pool } = self;
    let parse = _.find(parses, (parse) => parse.match(url));
    if (!parse) throw new SpiderError(`no parse ${url}`);

    let html = await self.snapshoot(url, options.headers);
    let ret;
    try {
        ret = await parse.parse(html);
    } catch (err) {
        debug('parse fail: %s', err.stack);
        // 修改实现。异常向上继续抛，调用者决定如何处理、记录异常
        // await pool.query('update links set cause = ?, html = ?, state = ? where link = ?', [err.stack, html, 'failed', url]);
        throw new SpiderError(err, html);
    }

    let conn = await pool.getConnection();
    await conn.beginTransaction();
    try {
        await conn.query('update links set html = ?, state = ? where link = ?', [html, 'complete', url]);
        if (ret.links.length > 0) {
            // insert or update
            // await conn.query('insert into links(link) values ?', [ret.links.map(link => [link])]);
            // await conn.query('insert into links(link) values ? on duplicate key update referer = ? ', [[link], url]);
            await Promise.all(ret.links.map(link => conn.query('insert into links(link, referer) select ?, ? where not exists (select 1 from links where link = ?)', [link, url, link])));
            await conn.query('insert into link_referers(link, referer) values ?', [ret.links.map(link => [link, url])]);
        }
        await conn.commit();
    } catch (err) {
        debug('process ret fail: %s', err.stack);
        await conn.rollback();
        throw new SpiderError(err, html);
    } finally {
        if (conn) conn.release();
    }

    debug('Spider.parse done %s', url);
}

Spider.prototype.snapshoot = async function (uri, headers = {}) {
    let uriObj = url.parse(uri);
    let dest = path.join(this.dir, 'html', uriObj.host, uriObj.pathname, 'index.html');
    try {
        let html = await read(dest);
        if (isStandardHtml(html)) return html;
    } catch (err) { /* ignore */ }

    let request = this.request;
    let get = util.promisify(request.get);

    let { statusCode, body } = await get(encodeURI(uri), { headers: _.merge(HEADERS, headers) });
    if (statusCode !== 200) throw new SpiderError(`SNAPSHOOT-${statusCode}-[${uri}]`, body);
    // 校验返回的HTML是否合法
    if (!isStandardHtml(body)) throw new SpiderError(`NOT-STANDARD-HTML-[${uri}]`, body);
    if (!!config.storeSnapshoot) await write(dest, body);
    return body;
}

Spider.prototype.download = async function (url, dest, headers = {}) {
    // let dest = path.join(this.dir, this.base64.encode(url), path.extname(url));
    await download(url, dest, {
        headers: _.merge(HEADERS, headers)
    });
}

Spider.prototype.start = async function () {
    try {
        await this._start();
    } catch (err) {
        logger.warning('_start() fail.');
        logger.warning(`${err.name}: ${err.message}\n${err.stack}\n${err.originStack || ''}`);
    }
    await delay(config.taskDelay);
    this.start().catch((err) => logger.warning(`${err.name}: ${err.message}\n${err.stack}\n${err.originStack || ''}`));
}

// Spider.prototype.stop = async function() {
//     // 退出
//     this.running = false;
// }

// state 
// - active
// - inactive
// - failed
// - complete
Spider.prototype._start = async function () {
    let self = this;
    let pool = self.pool;
    let [links] = await pool.query('select link,referer,version from links where state = ? limit 0,1', ['inactive']);
    debug('links: %j', links);
    if (links.length === 0) return await self.pool.end();
    let link = links[0];
    // 并发处理
    let [{ affectedRows = 0 }] = await pool.query(`update links set state = ?, version = ? where link = ? and version = ?`, ['active', link.version + 1, link.link, link.version]);
    debug('affectedRows: %d', affectedRows);
    if (affectedRows === 0) return;

    let headers = {};
    if (!!link.referer) headers.referer = encodeURI(link.referer);
    await self.parse(link.link, { headers: headers }).catch((err) => logger.warning(`${err.name}: ${err.message}\n${err.stack}\n${err.originStack || ''}`));

    // let tasks = parallel(links, 1);
    // debug('tasks: %j', tasks);
    // for (let links of tasks) {
    //     debug('task: %j', links);

    //     await Promise.all(links.map(link => {
    //         let headers = {};
    //         if (!!link.referer) headers.referer = encodeURI(link.referer);
    //         return self.parse(link.link, { headers: headers })
    //             .then(console.log)
    //             .catch(console.error);
    //     }));

    //     // 延迟8s
    //     await delay(config.taskDelay);
    // }
    // debug('next tasks.');
}

let spider = new Spider({
    mysql: config.mysql,
    parses: [new DoubanTagIndex(), new DoubanTagPage(), new DoubanBookPage()]
});

spider.start().catch(logger.warning.bind(logger));

process.on('uncatchException', (err) => {
    logger.error('<---------- uncatchException');
    logger.error(`${err.name}: ${err.message}\n${err.stack}\n${err.originStack || ''}`);
    // TODO 平稳退出
    process.exit(1);
});

process.on('SIGHUP', () => {
    logger.info('restart...');
});

process.on('SIGINT', () => {
    logger.info('shutdown...');
    process.exit(0);
});