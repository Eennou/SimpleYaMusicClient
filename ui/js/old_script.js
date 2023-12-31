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

var playlist;
var player;
var trackProgress;
var lastChangedTrack = 0;
var playing = false;
var preloaded = false;
var progressChange = false;
var currentTrack;
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
        console.log("okay");
        promise = document.backend.load_resource(path);
    } else {
        console.log("later");
        let storeResolve;
        promise = new Promise((resolve, reject) => {
            storeResolve = resolve;
        });
        getResourceQueue.push([path, storeResolve]);
    }
    return promise;
}
function toggleMenu() {
    var menu = document.querySelector(".menu");
    if (menu.classList.contains("hidden")) {
        document.backend.get_playlists().then((playlists) => {
            [...menu.children].forEach((playlist, index) => {
                if (index > 0) {
                    playlist.remove();
                }
            });
            playlists.forEach((playlist) => {
                var playlist_node = document.createElement("div");
                playlist_node.id = `playlist${playlist["owner"]["uid"]}_${playlist["kind"]}`;
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
function loadPlaylist(playlist_id) {
    document.backend.play_playlist(playlist_id).then((result) => {
        playlist.innerHTML = "";
        updatePlaylist(result);
        updatePlayer(result[0], result[1]);
        document.backend.load_track(currentTrack).then((result) => {
            loadTrack(result);
        });
    });
}
function updatePlaylist(tracks) {
    tracks.forEach((track) => {
        var track_node = document.createElement("div");
        track_node.classList = "track";
        track_node.id = "track"+track["track_id"].replace(":", "_");
        track_node.innerHTML = `
            <img class="glow-cover" src="${track["cover_url"]}100x100" />
            <img class="cover" src="${track["cover_url"]}100x100" />
            <p class="title">${track["title"]}</p>
            <p class="artists">${track["artists"]}</p>
            <div>
            <button class="icon track-skip-queue" onclick="queueSetForTrackInPlaylist(this.parentNode.parentNode)"><ion-icon name="play"></ion-icon></button>
            <button class="icon track-add-queue" onclick="queueAddForTrackInPlaylist(this.parentNode.parentNode)"><ion-icon name="add"></ion-icon></button>
            <button class="icon track-move-queue"><ion-icon name="reorder-three"></ion-icon></button>
        `;
        playlist.appendChild(track_node);
    })
    cullTracks();
}
function cullTracks() {
    var autoCull = false;
    [...playlist.children].forEach((track) => {
        if (autoCull || track.offsetTop + track.offsetHeight + 100 < playlist.scrollTop ||
            track.offsetTop - 100 > playlist.scrollTop + playlist.clientHeight) {
            if (!autoCull && track.offsetTop - 100 > playlist.scrollTop + playlist.clientHeight) autoCull = true;
            track.classList.add("culled");
        } else {
            track.classList.remove("culled");
        }
    });
}
function updatePlayer(track, next_track) {
    player.querySelector(".background").style.background = `url(${track["cover_url"]}100x100) center center / cover`;
    player.querySelector(".controls .primary-cover").setAttribute("src", track["cover_url"]+"200x200");
    if (next_track) player.querySelector(".controls .secondary-cover").setAttribute("src", next_track["cover_url"]+"200x200");
    player.querySelector(".controls .title").innerText = track["title"];
    player.querySelector(".controls .artists").innerText = track["artists"];
    preloaded = false;
    currentTrack = track["track_id"];
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
    document.querySelector("#track"+currentTrack.replace(":", "_")).classList.add("active");
}
function pauseTrack() {
    soundFile.pause();
    document.querySelector("#track"+currentTrack.replace(":", "_")).classList.remove("active");
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
    document.backend.prev_track().then((index) => {
        document.backend.get_queue().then((result) => {
            pauseTrack();
            updatePlayer(result[index], result[index+1]);
            document.querySelector(".player").classList.add("prev-track-anim");
        });
    });
    setTimeout(() => {
        document.querySelector(".player").classList.remove("prev-track-anim");
        document.backend.load_track(currentTrack).then((path) => {
            loadTrack(path);
        });
    }, 500);
}
function nextTrack() {
    if (Date.now() - lastChangedTrack < 700) {
        return;
    }
    lastChangedTrack = Date.now();
    document.querySelector(".player").classList.add("next-track-anim");
    setTimeout(() => {
        document.backend.next_track().then((index) => {
            document.backend.get_queue().then((result) => {
                pauseTrack();
                updatePlayer(result[index], result[index+1]);
                document.querySelector(".player").classList.remove("next-track-anim");
                document.backend.load_track(currentTrack).then((path) => {
                    loadTrack(path);
                });
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
            updatePlayer(result[index], result[index+1]);
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
        console.log(request);
        request[1](document.backend.load_resource(request[0]));
    });
    loadResource("main.html", () => {
        document.backend.get_volume().then((volume) => {
            document.querySelector(".volume-slider").value = volume;
            setVolume(volume);
        });
        playlist = document.querySelector(".playlist");
        playlist.addEventListener("scroll", cullTracks);
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
        updatePlayer(result[0], result[1]);
        document.backend.load_track(currentTrack).then((result) => {
            loadTrack(result);
        });
        setTimeout(() => document.querySelector(".loading-container").remove(), 500)
    });
}

