const fs = require('fs');
const path = require('path');
process.env.NODE_CONFIG_DIR = path.join(__dirname, 'config');
// 默认config会去加载./config目录
// 修改运行目录 强制为执行文件所在文件夹
// if (path.basename(__dirname) === '__enclose_io_memfs__' /*__dirname === '/__enclose_io_memfs__' || __dirname === 'C:\__enclose_io_memfs__' */) 
//     process.chdir(path.dirname(process.argv[0]));
// else process.chdir(path.dirname(process.argv[1]));
const debug = require('debug')('spider:daemon');
const argv = require('yargs').argv;
const _ = require('lodash');
const fork = require('child_process').fork;
const Log = require('log');
const config = (function () {
    if (argv.config) {
        debug('config: %s', path.resolve(argv.config));
        let config = require(path.resolve(argv.config));
        return _.merge(require('config'), config);
    } else {
        return require('config');
    }
})();
const logFileStream = fs.createWriteStream(config.logpath, { flags: 'a' });
const logger = new Log('info', logFileStream);
debug('config: %o', config);
debug('env: %o, argv', process.env, process.argv);

function createWorker() {
    let worker = fork(path.join(__dirname, 'index.js'), process.argv.slice(2), {
        env: process.env
    });

    worker.on('exit', (code) => {
        logger.info(`Worker ${worker.pid} exited. ${code}`);
        if (code !== 0) {
            setTimeout(() => {
                createWorker();
            }, 2000);
        }
    });

    logger.info(`Create worker. pid: ${worker.pid}.`);
}


createWorker();

process.on('SIGINT', () => {
    
});