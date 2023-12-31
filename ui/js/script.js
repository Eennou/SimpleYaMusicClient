document.backend = undefined;
try {
    new QWebChannel(qt.webChannelTransport, function (channel) {
        document.backend = channel.objects.backend;
        setTimeout(onBackendConnect, 250);
    });
} catch (e) {
    document.backend = new class Fallback {
        load_resource() {return new Promise((resolve, reject) => {resolve("<p style=\"text-align: center; transform: translateY(calc(50vh - 50% - 20px));\">QWebChannel not connected</p>")})}
    }()
    onBackendConnect();
}

function loadResource(name, func, append=false) {
    document.backend.load_resource(name).then((result) => {
        if (append) {
            document.querySelector(".page-view").innerHTML += result;
        } else {
            document.querySelector(".page-view").innerHTML = result;
        }
        func();
    });
};

var menu;
var lyrics;
var lyrics_time;
var playlist;
var playlistView;
var player;
var trackProgress;
var lastChangedTrack = 0;
var playing = false;
var preloaded = false;
var progressChange = false;
var currentTrack;
var queueIndex;
var soundFile;
var audioSource;

document.addEventListener("DOMContentLoaded", function () {
    soundFile = document.createElement("audio");
    soundFile.preload = "auto";
    audioSource = document.createElement("source");
    soundFile.appendChild(audioSource);
    soundFile.onended = nextTrack;
});

getResourceQueue = []
document.getResource = function (path) {
    let promise;
    if (typeof document.backend !== "undefined") {
        promise = document.backend.load_resource(path);
    } else {
        let storeResolve;
        promise = new Promise((resolve, reject) => {
            storeResolve = resolve;
        });
        getResourceQueue.push([path, storeResolve]);
    }
    return promise;
}

var x = null;
var y = null;
var draggable = null;

document.addEventListener('mousemove', onMouseUpdate, false);
document.addEventListener('mouseenter', onMouseUpdate, false);

function onMouseUpdate(e) {
    x = e.pageX;
    y = e.pageY;

    if (draggable) {
        if (e.which == 0) {
            stopReorder();
        } else {
            draggable.style.top = y - 25 + "px";
        }
    }
}

function toggleLyrics() {
    lyrics.classList.toggle("hidden");
}
function loadLyrics() {
    lyrics.querySelector(".lines").scrollTop = 0;
    lyrics.querySelector(".lines").innerHTML = "";
    lyrics_time = [];
    document.backend.get_track_lyrics(currentTrack).then((lyrics_info) => {
        if (lyrics_info["supported"]) {
            console.log(lyrics_info["lyrics"]);
            lyrics_info["lyrics"].forEach((line) => {
                var line_node = document.createElement("div");
                line_node.innerText = line[1];
                lyrics.querySelector(".lines").appendChild(line_node);
                lyrics_time.push(line[0]);
            });
        } else {
            var line_node = document.createElement("div");
            line_node.innerText = "Текст песни недоступен";
            lyrics.querySelector(".lines").appendChild(line_node);
        }
    });
}

function toggleMenu() {
    if (menu.classList.contains("hidden")) {
        document.backend.get_playlists().then((playlists) => {
            [...menu.children].forEach((playlist, index) => {
                if (index > 1) {
                    playlist.remove();
                }
            });
            playlists.forEach((playlist) => {
                var playlist_node = document.createElement("div");
                playlist_node.id = `playlist${playlist["owner"]["uid"]}_${playlist["kind"]}`;
                playlist_node.onclick = () => {loadPlaylistView(`${playlist["owner"]["uid"]}:${playlist["kind"]}`)};
                playlist_node.innerHTML = `
                    <ion-icon class="playlist-icon" name="list"></ion-icon>
                    <p>${playlist["title"]}</p>
                    <ion-icon class="arrow-right" name="chevron-forward"></ion-icon>
                    <button class="icon play" onclick="loadPlaylist('${playlist["owner"]["uid"]}:${playlist["kind"]}')"><ion-icon name="play"></ion-icon></button>
                `;
                menu.appendChild(playlist_node);
            })
        });
    }
    menu.classList.toggle("hidden");
}
function clearQueue() {
    document.backend.clear_queue();
    playlist.innerHTML = "";
    updatePlaylist([]);
    updatePlayer();
}
function loadPlaylist(playlist_id) {
    document.backend.load_playlist(playlist_id, true).then((result) => {
        playlist.innerHTML = "";
        updatePlaylist(result);
        updatePlayer(result[0], result[1]);
        document.backend.load_track(currentTrack).then((result) => {
            loadTrack(result);
        });
    });
}
function loadPlaylistView(playlist_id) {
    console.log(playlist_id);
    document.backend.load_playlist(playlist_id, false).then((result) => {
        playlistView.innerHTML = "";
        updateViewPlaylist(result);
        playlistView.classList.remove("hidden");
        menu.classList.add("hidden");
    });
}
function updatePlaylist(tracks) {
    tracks.forEach((track) => {
        playlist.appendChild(getTrackNode(track, false));
    })
    cullTracks(playlist);
}
function updateViewPlaylist(tracks) {
    tracks.forEach((track) => {
        playlistView.appendChild(getTrackNode(track, true));
    })
    cullTracks(playlistView);
}
function startReorder(track) {
    track.classList.remove("culled");
    track.classList.add("dragging-anim");
    setTimeout(() => {
        track.classList.add("dragging");
        draggable = track;
        draggable.style.top = y - 25 + "px";
    }, 200);
}
function stopReorder() {
    let currentIndex = Array.prototype.indexOf.call(playlist.children, draggable);
    let targetIndex = Math.max(Math.ceil((draggable.offsetTop + playlist.scrollTop) / 55) - 1, 0);
    playlist.appendChild(draggable);
    playlist.insertBefore(draggable, playlist.children[targetIndex]);
    draggable.classList.remove("dragging");
    let draggable_tmp = draggable;
    setTimeout(() => {
        draggable_tmp.classList.remove("dragging-anim");
    }, 10);
    draggable.style.top = 0;
    draggable = null;
    document.backend.reorder_track_in_queue(currentIndex, targetIndex).then((info) => {
        queueIndex = info[0];
        updatePlayer(info[1], info[2]);
    });
}
function getTrackNode(track, isView) {
    var track_node = document.createElement("div");
    track_node.classList = "track";
    track_node.id = "track"+track["track_id"].replace(":", "_");
    let skipButton = "";
    let moveButton = "";
    if (!isView) {
        skipButton = '<button class="icon track-skip-queue" onclick="queueSetForTrackInPlaylist(this.parentNode.parentNode)"><ion-icon name="play"></ion-icon></button>';
        moveButton = '<button class="icon track-move-queue" onmousedown="startReorder(this.parentNode.parentNode)"><ion-icon name="reorder-three"></ion-icon></button>'
    }
    track_node.innerHTML = `
        <img class="glow-cover" src="${track["cover_url"]}100x100" />
        <img class="cover" src="${track["cover_url"]}100x100" />
        <p class="title">${track["title"]}</p>
        <p class="artists">${track["artists"]}</p>
        <div>
        ${skipButton}
        <button class="icon track-add-queue" onclick="queueAddForTrackInPlaylist(this.parentNode.parentNode)"><ion-icon name="add"></ion-icon></button>
        ${moveButton}
    `;
    return track_node;
}
function cullTracks(playlist_node) {
    var autoCull = false;
    [...playlist_node.children].forEach((track) => {
        if ((autoCull || track.offsetTop + track.offsetHeight + 100 < playlist_node.scrollTop ||
            track.offsetTop - 100 > playlist_node.scrollTop + playlist_node.clientHeight) && !track.classList.contains("dragging")) {
            if (!autoCull && track.offsetTop - 100 > playlist_node.scrollTop + playlist.clientHeight) autoCull = true;
            track.classList.add("culled");
        } else {
            track.classList.remove("culled");
        }
    });
}
function updatePlayer(track, next_track) {
    player.querySelector(".controls .prev-track").disabled = queueIndex == 0;
    player.querySelector(".controls .next-track").disabled = !next_track;
    player.querySelector(".controls .pause-track").disabled = !track;
    player.querySelector(".background").style.background = track ? `url(${track["cover_url"]}100x100) center center / cover` : "black";
    lyrics.querySelector(".background").style.background = track ? `url(${track["cover_url"]}100x100) center center / cover` : "black";
    player.querySelector(".controls .primary-cover").setAttribute("src", track ? track["cover_url"]+"200x200" : "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAAAXNSR0IArs4c6QAAAA1JREFUGFdjYGBg+A8AAQQBAHAgZQsAAAAASUVORK5CYII=");
    if (next_track) player.querySelector(".controls .secondary-cover").setAttribute("src", next_track["cover_url"]+"200x200");
    player.querySelector(".controls .title").innerText = track ? track["title"] : "Выберите трек";
    player.querySelector(".controls .artists").innerText = track ? track["artists"] : ":)";
    preloaded = false;
    currentTrack = track["track_id"];
    loadLyrics();
}

function loadTrack(fileName) {
    audioSource.src = fileName;

    trackProgress.value = 0; // half-progress on loading fix
    soundFile.load();
    soundFile.currentTime = 0;
    trackProgress.value = 0;
    if (playing) {
        playTrack();
    }
}
function setVolume(volume) {
    soundFile.volume = volume*volume; // exponential volume
    let icon = document.querySelector(".volume-wrapper .volume-icon");
    icon.classList = "volume-icon vol"+Math.ceil(volume*3);
    document.backend.set_volume(volume);
}
function playTrack() {
//   soundFile.currentTime = 0.01;
//   soundFile.volume = 0.1;
//   soundFile.muted = false;

    soundFile.play();
    playlist.querySelector(".track:nth-child("+(queueIndex+1)+")").classList.add("active");
}
function pauseTrack() {
    soundFile.pause();
    playlist.querySelector(".track:nth-child("+(queueIndex+1)+")").classList.remove("active");
}
function prevTrack() {
    if (Date.now() - lastChangedTrack < 700) {
        return;
    }
    if (soundFile.currentTime > 3) {
        soundFile.currentTime = 0;
        return;
    }
    lastChangedTrack = Date.now();
    lyrics.classList.add("change-track-anim");
    pauseTrack();
    document.backend.prev_track().then((info) => {
        queueIndex = info[0];
        updatePlayer(info[1], info[2]);
        player.classList.add("prev-track-anim");
        setTimeout(() => {
            document.backend.load_track(info[1]["track_id"]).then((result) => {
                loadTrack(result);
                lyrics.classList.remove("change-track-anim");
                player.classList.remove("prev-track-anim");
            });
        }, 500);
    });
}
function nextTrack() {
    if (Date.now() - lastChangedTrack < 700) {
        return;
    }
    lastChangedTrack = Date.now();
    lyrics.classList.add("change-track-anim");
    player.classList.add("next-track-anim");
    pauseTrack();
    setTimeout(() => {
        document.backend.next_track().then((info) => {
            document.backend.load_track(info[1]["track_id"]).then((result) => {
                queueIndex = info[0];
                updatePlayer(info[1], info[2]);
                loadTrack(result);
                lyrics.classList.remove("change-track-anim");
                player.classList.remove("next-track-anim");
            });
        });
    }, 500);
}
function queueAddForTrackInPlaylist(track) {
    queueAdd(track.id.replace("track", "").replace("_", ":"));
}
function queueAdd(track_id) {
    document.backend.add_track_to_queue(track_id).then((track) => {
        updatePlaylist([track]);
        document.backend.get_queue().then((result) => {
            let lastTrack = currentTrack;
            updatePlayer(result[queueIndex], result[queueIndex+1]);
            if (lastTrack != currentTrack) {
                document.backend.load_track(currentTrack).then((result) => {
                    loadTrack(result);
                });
            }
        });
    });
}
function queueSetForTrackInPlaylist(track) {
    queueSet(Array.prototype.indexOf.call(track.parentNode.children, track), track.querySelector(".cover").getAttribute("src").replace("100x100", "200x200"));
}
function queueSet(index, track_cover) {
    pauseTrack();
    player.querySelector(".controls .secondary-cover").setAttribute("src", track_cover);
    document.querySelector(".player").classList.add("next-track-anim");
    document.backend.set_current_index_queue(index);
    setTimeout(() => {
        document.backend.get_queue().then((result) => {
            queueIndex = index;
            updatePlayer(result[index], result[index+1]);
            document.querySelector(".player").classList.remove("next-track-anim");
            document.backend.load_track(currentTrack).then((result) => {
                loadTrack(result);
            });
        });
    }, 500);
}

function onBackendConnect() {
    getResourceQueue.forEach(function (request) {
        request[1](document.backend.load_resource(request[0]));
    });
    loadResource("main.html", () => {
        document.backend.get_volume().then((volume) => {
            document.querySelector(".volume-slider").value = volume;
            setVolume(volume);
        });
        menu = document.querySelector(".menu");
        lyrics = document.querySelector(".lyrics");
        playlist = document.querySelector(".playlist.order");
        playlistView = document.querySelector(".playlist.view");
        playlist.addEventListener("scroll", () => {cullTracks(playlist)});
        playlistView.addEventListener("scroll", () => {cullTracks(playlistView)});
        player = document.querySelector(".player");
        trackProgress = document.querySelector(".track-progress");
        setInterval(() => {
            if (progressChange) {
                return;
            }
            trackProgress.value = soundFile.currentTime/soundFile.duration;
            if (soundFile.duration - soundFile.currentTime < 20 && !preloaded) {
                document.backend.preload_track();
                preloaded = true;
            }
            if (!lyrics.classList.contains("hidden")) {
                let lines = lyrics.querySelector(".lines");
                [...lines.children].forEach((line, index) => {
                    if (lyrics_time[index] <= soundFile.currentTime && soundFile.currentTime < lyrics_time[index+1] && playing) {
                        let targetScroll = line.offsetTop - lyrics.clientHeight / 2;
                        if (!line.classList.contains("active")) {
                            lines.scrollTo({top: targetScroll, behavior: "smooth"})
                            line.classList.add("active");
                        }
                    } else {
                        line.classList.remove("active");
                    }
                });
            }
        }, 100);
        document.querySelector(".player .controls .prev-track").addEventListener("click", function () {
            prevTrack();
        });
        document.querySelector(".player .controls .pause-track").addEventListener("click", function () {
            playing = !playing;
            this.classList = "icon pause-track" + (playing ? " playing" : "");
            if (playing) {
                playTrack();
            } else {
                pauseTrack();
            };
        });
        document.querySelector(".player .controls .next-track").addEventListener("click", function () {
            nextTrack();
        });
    }, true);
    document.backend.get_queue().then((result) => {
        updatePlaylist(result);
        queueIndex = 0;
        updatePlayer(result[0], result[1]);
        document.backend.load_track(result[0]["track_id"]).then((result) => {
            loadTrack(result);
        });
        setTimeout(() => document.querySelector(".loading-container").remove(), 500)
    });
}

