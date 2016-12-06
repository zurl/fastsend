/**
 * Created by zcy on 12/4/16.
 */
var remoteConnection;
var statusDivRecv = document.querySelector('#statusdivrecv');
var receiverSocket = senderSocket;
//Binding the event listener to the receiver button
var joinButton = document.querySelector('#join');
joinButton.addEventListener('click', () => {
    createConnectionRemote();
    return false;
});
var filemeta = null;
receiverSocket.on('receiver::req-desc', function(data){
    console.log(`receiver::req-desc ${data}`);
    const obj = JSON.parse(data);
    if(obj.status == 'failed'){
        statusDivRecv.innerText = 'rec: failed in req-desc';
        rtcServer.remoteDescriptionOnRecvCallback();
    }
    else if(obj.status == 'ok'){
        statusDivRecv.innerText = 'ok, try to connect server';
        filemeta = JSON.parse(obj.fileMeta);
        rtcServer.remoteDescriptionOnRecvCallback(obj.data);
    }
});

receiverSocket.on('receiver::send-desc', function(data){
    console.log(`receiver::send-desc ${data}`);
    const obj = JSON.parse(data);
    if(obj.status == 'failed'){
        statusDivRecv.innerText = 'send-desc';
        //rtcServer.localDescriptionOnErrorCallback();
    }
    else if(obj.status == 'ok'){
        statusDivRecv.innerText = 'ok, connected server';
        //rtcServer.localDescriptionOnRecvCallback(obj.data);
    }

});
receiverSocket.on('receiver::ice', function(data){
    console.log(`rreceiver::ice ${data}`);
    const obj = JSON.parse(data);
    const candidate =  new RTCIceCandidate(JSON.parse(obj.data));
    remoteConnection.addIceCandidate(
        candidate
    ).then(
        onAddIceCandidateSuccess,
        onAddIceCandidateError
    );
    trace('Local ICE candidate: \n' + candidate.candidate);
});

//create recieve connection
function createConnectionRemote(){
    var servers = null;
    // Add remoteConnection to global scope to make it visible
    // from the browser console.
    window.remoteConnection = remoteConnection = new RTCPeerConnection(servers,
        pcConstraint);
    trace('Created remote peer connection object remoteConnection');

    remoteConnection.onicecandidate = iceCallbackRemote;
    remoteConnection.ondatachannel = receiveChannelCallback;

    fileInput.disabled = true;
    requestDescriptionRemote().then(
        (desc) => {
            desc = new RTCSessionDescription(JSON.parse(desc));
            trace('Offer from localConnection \n' + desc.sdp);
            remoteConnection.setRemoteDescription(desc);
            return remoteConnection.createAnswer()
        },
        onCreateSessionDescriptionError
    ).then(
        sendDescriptionRemote,
        onCreateSessionDescriptionError
    );
}

//onCreateChannelRemote
function iceCallbackRemote(event) {
    trace('local ice callback');
    receiverSocket.emit('receiver::ice', JSON.stringify({
        token: tokenInput.value,
        data: JSON.stringify(event.candidate)
    }));
}


function sendDescriptionRemote(desc){
    console.log(` set remote description`);
    remoteConnection.setLocalDescription(desc);
    receiverSocket.emit('receiver::send-desc', JSON.stringify({
        token: tokenInput.value,
        data: JSON.stringify(desc)
    }));

    //rtcServer.localDescriptionOnRecvCallback(JSON.stringify(desc));
}

function requestDescriptionRemote(){
    receiverSocket.emit('receiver::req-desc', JSON.stringify({
        token: tokenInput.value,
        data: null
    }));
    return new Promise((res, rej)=>{
        rtcServer.remoteDescriptionOnRecvCallback = res;
        rtcServer.remoteDescriptionOnErrorCallback = rej;
    });
}


function receiveChannelCallback(event) {
    trace('Receive Channel Callback');
    receiveChannel = event.channel;
    receiveChannel.binaryType = 'arraybuffer';
    receiveChannel.onmessage = onReceiveMessageCallback;
    receiveChannel.onopen = onReceiveChannelStateChange;
    receiveChannel.onclose = onReceiveChannelStateChange;

    receivedSize = 0;
    bitrateMax = 0;
    downloadAnchor.textContent = '';
    downloadAnchor.removeAttribute('download');
    if (downloadAnchor.href) {
        URL.revokeObjectURL(downloadAnchor.href);
        downloadAnchor.removeAttribute('href');
    }
}

function onReceiveChannelStateChange() {
    var readyState = receiveChannel.readyState;
    trace('Receive channel state is: ' + readyState);
    if (readyState === 'open') {
        timestampStart = (new Date()).getTime();
        timestampPrev = timestampStart;
        statsInterval = window.setInterval(displayStats, 500);
        window.setTimeout(displayStats, 100);
        window.setTimeout(displayStats, 300);
    }
}


function onReceiveMessageCallback(event) {
    // trace('Received Message ' + event.data.byteLength);
    receiveBuffer.push(event.data);
    receivedSize += event.data.byteLength;

    receiveProgress.value = receivedSize;

    // we are assuming that our signaling protocol told
    // about the expected file size (and name, hash, etc).
    var file = filemeta;
    if (receivedSize === file.size) {
        var received = new window.Blob(receiveBuffer);
        receiveBuffer = [];

        downloadAnchor.href = URL.createObjectURL(received);
        downloadAnchor.download = file.name;
        downloadAnchor.textContent =
            'Click to download \'' + file.name + '\' (' + file.size + ' bytes)';
        downloadAnchor.style.display = 'block';

        var bitrate = Math.round(receivedSize * 8 /
            ((new Date()).getTime() - timestampStart));
        bitrateDiv.innerHTML = '<strong>Average Bitrate:</strong> ' +
            bitrate + ' kbits/sec (max: ' + bitrateMax + ' kbits/sec)';

        if (statsInterval) {
            window.clearInterval(statsInterval);
            statsInterval = null;
        }

        closeDataChannelRemote();
    }
}

function closeDataChannelRemote() {
    if (receiveChannel) {
        receiveChannel.close();
        trace('Closed data channel with label: ' + receiveChannel.label);
    }
    remoteConnection.close();
    remoteConnection = null;
    trace('Closed peer connections');
    fileInput.disabled = false;
}

// display bitrate statistics.
function displayStats() {
    var display = function(bitrate) {
        bitrateDiv.innerHTML = '<strong>Current Bitrate:</strong> ' +
            bitrate + ' kbits/sec';
    };

    if (remoteConnection && remoteConnection.iceConnectionState === 'connected') {
        if (adapter.browserDetails.browser === 'chrome') {
            // TODO: once https://code.google.com/p/webrtc/issues/detail?id=4321
            // lands those stats should be preferrred over the connection stats.
            remoteConnection.getStats(null, function(stats) {
                for (var key in stats) {
                    var res = stats[key];
                    if (timestampPrev === res.timestamp) {
                        return;
                    }
                    if (res.type === 'googCandidatePair' &&
                        res.googActiveConnection === 'true') {
                        // calculate current bitrate
                        var bytesNow = res.bytesReceived;
                        var bitrate = Math.round((bytesNow - bytesPrev) * 8 /
                            (res.timestamp - timestampPrev));
                        display(bitrate);
                        timestampPrev = res.timestamp;
                        bytesPrev = bytesNow;
                        if (bitrate > bitrateMax) {
                            bitrateMax = bitrate;
                        }
                    }
                }
            });
        } else {
            // Firefox currently does not have data channel stats. See
            // https://bugzilla.mozilla.org/show_bug.cgi?id=1136832
            // Instead, the bitrate is calculated based on the number of
            // bytes received.
            var bytesNow = receivedSize;
            var now = (new Date()).getTime();
            var bitrate = Math.round((bytesNow - bytesPrev) * 8 /
                (now - timestampPrev));
            display(bitrate);
            timestampPrev = now;
            bytesPrev = bytesNow;
            if (bitrate > bitrateMax) {
                bitrateMax = bitrate;
            }
        }
    }
}