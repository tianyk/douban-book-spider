const fs = require('fs');
const path = require('path');
// 默认config会去加载./config目录
process.env.NODE_CONFIG_DIR = path.join(__dirname, 'config');
// 修改运行目录 强制为执行文件所在文件夹
if (path.basename(__dirname) === '__enclose_io_memfs__' /*__dirname === '/__enclose_io_memfs__' || __dirname === 'C:\__enclose_io_memfs__' */) 
    process.chdir(path.dirname(process.argv[0]));
else process.chdir(path.dirname(process.argv[1]));
const fork = require('child_process').fork;
const config = require('config');
const Log = require('log');
const logFileStream = fs.createWriteStream(path.join(process.cwd(), 'daemon.log'), { flags: 'a' });
const logger = new Log('info', logFileStream);

function createWorker() {
    let worker = fork(path.join(__dirname, 'index.js'), {
        env: process.env
    });

    worker.on('exit', () => {
        logger.info(`Worker ${worker.pid} exited.`);
        setTimeout(() => {
            createWorker();
        }, 2000);
    });

    logger.info(`Create worker. pid: ${worker.pid}.`);
}

createWorker();