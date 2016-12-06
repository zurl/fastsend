/*
 *  Copyright (c) 2015 The WebRTC project authors. All Rights Reserved.
 *
 *  Use of this source code is governed by a BSD-style license
 *  that can be found in the LICENSE file in the root of the source
 *  tree.
 */
'use strict';

var localConnection;
var sendChannel;
var receiveChannel;
var pcConstraint;
var bitrateDiv = document.querySelector('div#bitrate');
var fileInput = document.querySelector('input#fileInput');
var downloadAnchor = document.querySelector('a#download');
var sendProgress = document.querySelector('progress#sendProgress');
var receiveProgress = document.querySelector('progress#receiveProgress');
var statusMessage = document.querySelector('span#status');
var statusDiv = document.querySelector('#statusdiv');

var tokenInput = document.querySelector('#token');
var joinButton = document.querySelector('#join');
var receiveBuffer = [];
var receivedSize = 0;

var bytesPrev = 0;
var timestampPrev = 0;
var timestampStart;
var statsInterval = null;
var bitrateMax = 0;

var senderSocket = io();

var rtcServer = {
    //description server
    localDescriptionOnRecvCallback: null,
    localDescriptionOnErrorCallback: null,

    remoteDescriptionOnRecvCallback: null,
    remoteDescriptionOnErrorCallback: null,
    //signal server
    localCandidate: null,
    localCandidateOnChangeCallback: null,
    localCandidateOnErrorCallback: null,

    remoteCandidate: null,
    remoteCandidateOnChangeCallback: null,
    remoteCandidateOnErrorCallback: null,
};

senderSocket.on('sender::send-desc', function(data){
    const obj = JSON.parse(data);
    if(obj.status == 'occupied'){
        statusDiv.innerText = 'occupied';
    }
    else if(obj.status == 'ok'){
        statusDiv.innerText = 'ok, waiting client';
    }
});

senderSocket.on('sender::get-desc', function(data){
console.log(`sender::get desc ${data}`);   
 const obj = JSON.parse(data);
    if(obj.status == 'failed'){
        statusDiv.innerText = 'failed in get-desc';
        rtcServer.localDescriptionOnErrorCallback();
    }
    else if(obj.status == 'ok'){
        statusDiv.innerText = 'ok, connected client';
        rtcServer.localDescriptionOnRecvCallback(obj.data);
    }
});
senderSocket.on('sender::ice', function(data){
    console.log(`sender::ice ${data}`);
const obj = JSON.parse(data);
    const candidate =  new RTCIceCandidate(JSON.parse(obj.data));
    localConnection.addIceCandidate(
        candidate
    ).then(
        onAddIceCandidateSuccess,
        onAddIceCandidateError
    );
    trace('remote ICE candidate: \n' + candidate.candidate);
});

tokenInput.addEventListener('input',() => {
    if(tokenInput.value == ""){
        fileInput.setAttribute('disabled', 'disabled');
        joinButton.setAttribute('disabled', 'disabled');
    }
    else {
        fileInput.removeAttribute('disabled');
        joinButton.removeAttribute('disabled');
    }
},false);

fileInput.addEventListener('change', ()=>{
    var file = fileInput.files[0];
    if (!file) {
        trace('No file chosen');
    } else {
        createConnectionLocal();
    }
}, false);

function iceCallback1(event) {
    trace('local ice callback');
    senderSocket.emit('sender::ice', JSON.stringify({
        token: tokenInput.value,
        data: JSON.stringify(event.candidate)
    }));
}


function sendDescriptionLocal1(desc){
    console.log(` set local description`);
    localConnection.setLocalDescription(desc);
    var file = fileInput.files[0];
    senderSocket.emit('sender::send-desc', JSON.stringify({
        token: tokenInput.value,
        data: JSON.stringify(desc),
        fileMeta: JSON.stringify({
            size : file.size,
            name : file.name,
            type : file.type
        })
    }));
    return new Promise((res, rej)=>{
        rtcServer.localDescriptionOnRecvCallback = res;
        rtcServer.localDescriptionOnErrorCallback = rej;
    });
}


function createConnectionLocal(){
    var servers = null;
    pcConstraint = null;

    // Add localConnection to global scope to make it visible
    // from the browser console.
    window.localConnection = localConnection = new RTCPeerConnection(servers,
        pcConstraint);
    trace('Created local peer connection object localConnection');

    console.log(servers);
    console.log(pcConstraint);

    sendChannel = localConnection.createDataChannel('sendDataChannel');
    sendChannel.binaryType = 'arraybuffer';
    trace('Created send data channel');

    sendChannel.onopen = onSendChannelStateChange;
    sendChannel.onclose = onSendChannelStateChange;
    localConnection.onicecandidate = iceCallback1;

    //Start exchange Description with Server;
    localConnection.createOffer().then(
        sendDescriptionLocal1,
        onCreateSessionDescriptionError
    ).then(
        (desc) => {
            desc = new RTCSessionDescription(JSON.parse(desc));
            trace('Answer from remoteConnection \n' + desc.sdp);
            localConnection.setRemoteDescription(desc);
        },
        onCreateSessionDescriptionError
    );
}

function onCreateSessionDescriptionError(error) {
    trace('Failed to create session description: ' + error.toString());
}
function sendData() {
    var file = fileInput.files[0];

    trace('File is ' + [file.name, file.size, file.type,
            file.lastModifiedDate
        ].join(' '));

    // Handle 0 size files.
    statusMessage.textContent = '';
    downloadAnchor.textContent = '';
    if (file.size === 0) {
        bitrateDiv.innerHTML = '';
        statusMessage.textContent = 'File is empty, please select a non-empty file';
        closeDataChannelLocal();
        return;
    }
    sendProgress.max = file.size;
    receiveProgress.max = file.size;
    var chunkSize = 16384;
    var sliceFile = function(offset) {
        var reader = new window.FileReader();
        reader.onload = (function() {
            return function(e) {
                sendChannel.send(e.target.result);
                if (file.size > offset + e.target.result.byteLength) {
                    window.setTimeout(sliceFile, 0, offset + chunkSize);
                }
                sendProgress.value = offset + e.target.result.byteLength;
            };
        })(file);
        var slice = file.slice(offset, offset + chunkSize);
        reader.readAsArrayBuffer(slice);
    };
    sliceFile(0);
}

function closeDataChannelLocal() {
    trace('Closing data channels');
    sendChannel.close();
    trace('Closed data channel with label: ' + sendChannel.label);
    localConnection.close();
    localConnection = null;
    trace('Closed peer connections');
    fileInput.disabled = false;
}

function onAddIceCandidateSuccess() {
    trace('AddIceCandidate success.');
}

function onAddIceCandidateError(error) {
    trace('Failed to add Ice Candidate: ' + error.toString());
}


function onSendChannelStateChange() {
    var readyState = sendChannel.readyState;
    trace('Send channel state is: ' + readyState);
    if (readyState === 'open') {
        sendData();
    }
}
