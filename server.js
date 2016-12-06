/**
 * Created by zcy on 12/4/16.
 */

const koa = require('koa');
const app = new koa();
const server = require('http').createServer(app.callback());
const io = require('socket.io')(server);
const serve =require('koa-static');

app.use(serve('./static'));
const state = new Map();

const maxtime = 1000 * 60 * 30;

io.on('connection', function(socket){
    socket.on('sender::send-desc', function (msg) {
        console.log(`sender::send-desc ${msg}`);
        const msgObj = JSON.parse(msg);
        if(!msgObj.token) return;
        const store = state.get(msgObj.token);
        const now = new Date().getTime();
        if(store){
            if(store.createDate + maxtime > now
                && store.status != 'finished') {
                socket.emit('sender::send-desc', JSON.stringify({
                    status : 'occupied',
                    data : null
                }));
                return;
            }
        }
        const newStore = {
            createDate: now,
            status: 'got-sender-desc',
            senderDesc: msgObj.data,
            senderSocket: socket,
            fileMeta: msgObj.fileMeta
        };
        state.set(msgObj.token, newStore);
        socket.emit('sender::send-desc', JSON.stringify({
            status : 'ok',
            data : null
        }));
    });
    socket.on('receiver::req-desc', function (msg){
        console.log(`receiver::req-desc ${msg}`);
        const msgObj = JSON.parse(msg);
        if(!msgObj.token) return;
        const store = state.get(msgObj.token);
        if(!store || store.status != 'got-sender-desc') {
            console.log(`receiver::req-desc failed`);
            socket.emit('receiver::req-desc', JSON.stringify({
                status : 'failed',
                data : null
            }));
            return;
        }
        store.status = 'send-sender-desc';
        console.log(`receiver::req-desc sended ${store.senderDesc}`);
        socket.emit('receiver::req-desc', JSON.stringify({
            status : 'ok',
            data : store.senderDesc,
            fileMeta: store.fileMeta
        }));
    });
    socket.on('receiver::send-desc', function (msg){
        console.log(`receiver::send-desc ${msg}`);
        const msgObj = JSON.parse(msg);
        if(!msgObj.token) return;
        const store = state.get(msgObj.token);
        if(!store || store.status != 'send-sender-desc') {
            socket.emit('receiver::send-desc', JSON.stringify({
                status : 'failed',
                data : null
            }));
            return;
        }
        store.status = 'send-receiver-desc';
        store.receiverDesc = msgObj.data;
        store.receiverSocket = socket;
        store.senderSocket.emit('sender::get-desc', JSON.stringify({
            status : 'ok',
            data : store.receiverDesc,
        }));
        socket.emit('receiver::send-desc', JSON.stringify({
            status : 'ok',
            data : null,
        }));
        if(store.senderICE){
            console.log(`send$ rev ice sec `);
            store.senderICE.forEach(x=>{
                store.receiverSocket.emit('receiver::ice', JSON.stringify({
                    status : 'ok',
                    data : x,
                }));
                store.senderICE = null;
            });
        }
    });
    socket.on('receiver::ice', function (msg){
        console.log(`receiver::ice ${msg}`);
        const msgObj = JSON.parse(msg);
        if(!msgObj.token|| !msgObj.data || msgObj.data == "null") return;
        const store = state.get(msgObj.token);
        if(!store)return;
        store.senderSocket.emit('sender::ice', JSON.stringify({
            status : 'ok',
            data : msgObj.data,
        }));
    });
    socket.on('sender::ice', function (msg){
        const msgObj = JSON.parse(msg);
        if(!msgObj.token|| !msgObj.data || msgObj.data == "null") return;
        const store = state.get(msgObj.token);
        console.log(`sender::ice ${msg}`);
        if(!store)return;
        if(store.senderICE)store.senderICE.push(msgObj.data);
        else store.senderICE = [msgObj.data];
        if(store.receiverSocket){
		    console.log(`send# recv ice first`);
            store.senderICE.forEach(x=>{
                store.receiverSocket.emit('receiver::ice', JSON.stringify({
                    status : 'ok',
                    data : x,
                }));
                store.senderICE = null;
            });
        }
    });
});
server.listen(2000,()=>console.log(`listen at 2000`));
