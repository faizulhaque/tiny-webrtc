var WebRTC = (function (opt) {
    "use strict";
    var connected = false,
        localStreamURL,
        myId,
        localStream,
        peerConnections = {},
        socket,
        cameraAccess = false,
        joinRoomOnConnect = false,
        channels = {video: true, audio: true},
        self = this,
        init = false;

    var events = {
        load: [],
        init: [],
        scriptLoaded: [],
        cameraAccess: [],
        connect: [],
        roomJoin: [],
        userConnect: [],
        userLeave: [],
        data: [],
        error: []
    };


    var config = {
        wsServer: 'ws://87.230.26.187/',  // websocket server
        iceServers: [
            {"url": "stun:stun.l.google.com:19302"}
        ],
        mediaConstraints: {
            mandatory: {
                OfferToReceiveAudio: true,
                OfferToReceiveVideo: true
            },
            optional: [
                {
                    RtpDataChannels: true
                }
            ]
        },
        roomParamType: "hash",
        roomParamName: "r",
        autoInit: true,
        autoJoinRoom: true,
        room: generateRoomName()
    };


    function dispatchEvent(name, param1, param2) {
        if (name == "error") {
            console.error(param1);
        }
        for (var i in events[name]) {
            if (events[name].hasOwnProperty(i) && typeof events[name][i] == "function") {
                events[name][i](param1, param2);
            }
        }
    }

    function getURLParameter(name) {
        var a = new RegExp(name + '=' + '(.+?)(&|$)').exec(location[config.roomParamType]);
        return a ? decodeURI(a[1]) : a;
    }

    function setSocketListener() {
        socket = new WebSocket(config.wsServer);
        setTimeout(function () {
            if (!connected) {
                dispatchEvent('error', "connecting to websocket server failed");
            }
        }, 5000);
        socket.onopen = function () {
            connected = true;
            var pRoom = getURLParameter(config.roomParamName);
            if (pRoom) {
                config.room = pRoom;
            }
        };

        socket.onmessage = function (msg) {
            msg = JSON.parse(msg.data);
            if (typeof socketFns[msg.fn] == 'function') {
                socketFns[msg.fn](msg.data);
            }
        };

        socket.onerror = function (e) {
            dispatchEvent('error', e.data);
        };
    }

    var socketFns = {
        userId: function (data) {
            myId = data.userId;
            dispatchEvent("connect", myId);
            if (config.autoJoinRoom || joinRoomOnConnect) {
                joinRoom();
            }
        },
        offer: function (data) {
            addPeerConnection(data.userId);
            peerConnections[data.userId].setRemoteDescription(new RTCSessionDescription(data.offer));
            peerConnections[data.userId].createAnswer(function (sessionDescription) {
                peerConnections[data.userId].setLocalDescription(sessionDescription);
                send("answer", {
                    userId: data.userId,
                    answer: sessionDescription
                });
            }, null, config.mediaConstraints);
        },
        answer: function (data) {
            peerConnections[data.userId].setRemoteDescription(new RTCSessionDescription(data.answer));
        },
        iceCandidate: function (data) {
            peerConnections[data.userId].addIceCandidate(new RTCIceCandidate({
                sdpMLineIndex: data.iceCandidate.label,
                candidate: data.iceCandidate.candidate
            }));
        },
        userLeave: function (data) {
            remove(data.userId);
        },
        roomJoinSuccess: function (data) {
            if (data.users.length != 0) {
                sendOffer(data.users);
            }
            dispatchEvent("roomJoin", config.room);
        },
        roomJoinError: function (data) {
            if (data == "room full") {
                dispatchEvent('error', "room limit reached");
            } else {
                dispatchEvent('error', "joining room on server failed");
            }
        }
    };

    function send(fn, data) {
        socket.send(JSON.stringify({fn: fn, data: data}));
    }

    function joinRoom() {
        if (socket) {
            if (config.room !== null) {
                send("joinRoom", {room: config.room});
            }
        } else {
            joinRoomOnConnect = true;
        }
    }

    function remove(userId) {
        if (peerConnections[userId]) {
            delete peerConnections[userId];
            dispatchEvent("userLeave", userId);
        }
    }

    function sendOffer(users) {
        for (var i in users) {
            if (users.hasOwnProperty(i))
                sendOfferToUser(users[i]);
        }
    }

    function sendOfferToUser(userId) {
        addPeerConnection(userId);
        peerConnections[userId].createOffer(function (sessionDescription) {
            send("offer", {
                userId: userId,
                offer: sessionDescription
            });
            peerConnections[userId].setLocalDescription(sessionDescription);
        }, null, config.mediaConstraints);
    }

    function generateRoomName() {
        return Math.floor(Math.random() * 999999);
    }


    function setCrossBrowserAPI() {
        window.navigator.getUserMedia = window.navigator.getUserMedia || window.navigator.webkitGetUserMedia || window.navigator.mozGetUserMedia || window.navigator.msGetUserMedia;
        window.URL = window.URL || window.webkitURL || window.mozURL || window.msURL;
        window.AudioContext = window.AudioContext || window.webkitAudioContext;
        window.RTCPeerConnection = window.webkitRTCPeerConnection || window.mozRTCPeerConnection
    }

    function getLocalStream(callback) {
        if (navigator.getUserMedia) {
            navigator.getUserMedia(channels, callback, function (err) {
                if (err.name === "DevicesNotFoundError" && channels.video) {
                    channels.video = false;
                    getLocalStream(callback);
                } else {
                    dispatchEvent('error', "An Error occured while accessing your camera and microphone. Please reload this page");
                }
            });
        } else {
            dispatchEvent('error', "no getUserMedia support on your browser :(");
        }
    }

    function addPeerConnection(userId) {
        var pc = new RTCPeerConnection({iceServers: config.iceServers}, config.mediaConstraints);
        pc = new RTCPeerConnection({iceServers: config.iceServers}, config.mediaConstraints);

        pc.onicecandidate = function (event) {
            if (event.candidate) {
                send("iceCandidate",
                    {
                        iceCandidate: {
                            type: 'candidate',
                            label: event.candidate.sdpMLineIndex,
                            id: event.candidate.sdpMid,
                            candidate: event.candidate.candidate
                        },
                        userId: userId
                    });
            }
        };
        pc.onconnecting = function () {
        };
        pc.onopen = function () {
        };
        pc.onaddstream = function (event) {
            pc.streamURL = getStreamUrl(event.stream);
            pc.stream = event.stream;
            dispatchEvent("userConnect", userId);
        };
        pc.onremovestream = function () {
            remove(userId);
        };
        pc.ondatachannel = function (event) {
            var receiveChannel = event.channel;
            receiveChannel.onmessage = function (event) {

            };
        };

        pc.addStream(localStream);
        pc.streamURL = "";
        pc.stream = "";
        pc.RTCDataChannel = pc.createDataChannel("RTCDataChannel", {reliable: false});

        pc.RTCDataChannel.onmessage = function (event) {
            var data = decodeURI(event.data);
            try {
                data = JSON.parse(data);
            } catch (e) {

            }
            dispatchEvent('data', userId, data);
        };

        peerConnections[userId] = pc;
    }

    function getStreamUrl(stream) {
        var url;
        try {
            url = window.URL.createObjectURL(stream) || stream;
        } catch (e) {
            url = stream;
        }
        return url;
    }


    self.init = function () {
        if (!init) {
            init = true;
            dispatchEvent("init");
            setCrossBrowserAPI();
            getLocalStream(function (localMediaStream) {
                cameraAccess = true;
                localStreamURL = getStreamUrl(localMediaStream);
                localStream = localMediaStream;
                dispatchEvent("cameraAccess", localStreamURL);
                setSocketListener();
            });

        }
    };


    // Event listener

    self.onLoad = function (callback) {
        events.load.push(callback);
    };

    self.onInit = function (callback) {
        events.init.push(callback);
    };

    self.onCameraAccess = function (callback) {
        events.cameraAccess.push(callback);
    };

    self.onConnect = function (callback) {
        events.connect.push(callback);
    };

    self.onRoomJoin = function (callback) {
        events.roomJoin.push(callback);
    };

    self.onUserConnect = function (callback) {
        events.userConnect.push(callback);
    };

    self.onUserLeave = function (callback) {
        events.userLeave.push(callback);
    };

    self.onData = function (callback) {
        events.data.push(callback);
    };

    self.onError = function (callback) {
        events.error.push(callback);
    };


    self.getRemoteStream = function (userId) {
        if (peerConnections[userId]) {
            return peerConnections[userId].streamURL;
        } else {
            return "";
        }
    };

    self.getLocalStream = function () {
        return localStreamURL;
    };

    self.joinRoom = function (room) {
        if (config.room !== null) {
            self.leaveRoom();
            config.room = room;
            joinRoom();
        } else {
            config.room = room;
            joinRoom();
        }
    };

    self.leaveRoom = function () {
        for (var i in peerConnections) {
            if (peerConnections.hasOwnProperty(i)) {
                peerConnections[i].stream.stop();
            }
        }
        if (socket) {
            send("leaveRoom");
        } else {
            config.room = null;
        }
    };

    self.getRoom = function () {
        return config.room;
    };


    self.sendData = function (userId, data) {
        var con = peerConnections[userId];
        if (con) {
            if (con.RTCDataChannel.readyState == "open") {
                if (typeof data == "object") {
                    data = JSON.stringify(data);
                }
                data = encodeURI(data);
                try {
                    con.RTCDataChannel.send(data);
                } catch (e) {
                    console.warn(e.message);
                }
            } else {
                setTimeout(function () {
                    self.sendData(userId, data);
                }, 100)
            }
        }
    };

    self.sendDataAll = function (data) {
        for (var i in peerConnections) {
            if (peerConnections.hasOwnProperty(i))
                self.sendData(i, data);
        }
    };

    self.getMyId = function () {
        return myId;
    };

    self.setConfig = function (opt) {
        if (typeof opt == "object" && opt !== null) {
            for (var i in config) {
                if (config.hasOwnProperty(i) && opt[i] !== undefined)
                    config[i] = opt[i];
            }
        }
    };


    self.setConfig(opt);
    setTimeout(function () {
        dispatchEvent("load");
    }, 0);
    if (config.autoInit) {
        setTimeout(function () {
            self.init();
        }, 0);
    }

});
