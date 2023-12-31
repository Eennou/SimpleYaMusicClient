import asyncio
import json
import os.path
import sys
import time
import traceback
import json
from types import NoneType

import yandex_music.track.track
from PyQt5.QtCore import Qt, pyqtSlot, pyqtSignal, QUrl, QVariant, QObject, QThread
from PyQt5.QtGui import QKeySequence, QIcon
from PyQt5.QtWebChannel import QWebChannel
from PyQt5.QtWebEngineWidgets import QWebEngineView, QWebEngineSettings
from PyQt5.QtWidgets import QApplication, QMainWindow, QShortcut
from system_hotkey import SystemHotkey

from yandex_music import Client


ya_music: Client = None
restart = False
tracks_cache = {}


def to_qvariant(x):
    if type(x) == list:
        return QVariant([to_qvariant(i) for i in x])
    elif type(x) in [int, str, NoneType, bool]:
        return x
    elif type(x) == dict:
        return x
    else:
        return QVariant(x.to_dict())


class MyWorker(QObject):
    @pyqtSlot(str, str)
    def preload_work(self, track_id, path):
        ya_music.tracks([track_id])[0].download(path, bitrate_in_kbps=320)


class DevWindow(QMainWindow):
    def __init__(self, scale, main_window):
        super().__init__()
        self.setWindowTitle("Simple Ya.Music DevTools")
        self.setWindowIcon(QIcon("./ui/icon_color.ico"))
        width, height = int(350 * scale), int(600 * scale)
        screen_resolution = self.screen().size()
        self.setGeometry(screen_resolution.width() - width - height, screen_resolution.height() - height - 100, height, height)
        self.webview = QWebEngineView()

        self.webview.setZoomFactor(scale)
        main_window.webview.page().setDevToolsPage(self.webview.page())
        self.setCentralWidget(self.webview)


class MainWindow(QMainWindow):
    showed = True
    show_hotkey = pyqtSignal()
    preload_track_signal = pyqtSignal(str, str)

    def __init__(self, scale):
        global ya_music
        super().__init__()
        if not os.path.exists(os.path.abspath("./cache/")):
            os.mkdir("./cache")
        if os.path.exists(os.path.abspath("./config.json")):
            with open("./config.json", "r") as file:
                self.config = json.load(file)
        else:
            self.config = {"token": "", "volume": 0.5, "hide_hotkey": ["kp_1"], "close_hotkey": "Ctrl+Q", "debug": False}

        if self.config["token"]:
            ya_music = Client(self.config["token"])
            ya_music.init()

        self.queue = []
        self.queue_position = 0
        self.scale = scale
        self.loop = asyncio.get_event_loop()

        self.setWindowTitle("Better Ya.Music")
        self.setWindowIcon(QIcon("./ui/icon_color.ico"))
        width, height = int(350 * self.scale), int(600 * self.scale)
        screen_resolution = self.screen().size()
        self.setGeometry(screen_resolution.width() - width, screen_resolution.height() - height - 100, width, height)

        self.setAttribute(Qt.WA_TranslucentBackground, True)
        self.setAttribute(Qt.WA_NoSystemBackground)
        self.setWindowFlags(Qt.FramelessWindowHint | Qt.WindowStaysOnTopHint | Qt.Tool)

        self.webview = QWebEngineView()
        self.webview.settings().setAttribute(QWebEngineSettings.LocalContentCanAccessFileUrls, True)
        self.webview.setContextMenuPolicy(Qt.NoContextMenu)
        self.webview.setZoomFactor(self.scale)

        if self.config["token"] == "":
            self.webview.load(QUrl("https://oauth.yandex.ru/authorize?response_type=token&client_id=23cabbbdc6cd418abb4b39c32c41195d"))
            self.setCentralWidget(self.webview)
            self.webview.loadStarted.connect(self.check_token)
            self.webview.loadProgress.connect(self.check_token)
        else:
            self.webview.load(QUrl("file:///ui/base.html"))
            self.channel = QWebChannel()
            self.channel.registerObject("backend", self)
            self.webview.page().setWebChannel(self.channel)
            self.webview.page().setBackgroundColor(Qt.transparent)
            self.setCentralWidget(self.webview)

            self.thread = QThread()
            self.worker = MyWorker()

            self.worker.moveToThread(self.thread)
            self.preload_track_signal.connect(self.worker.preload_work)
            self.thread.start()

            self.show_hotkey.connect(self.toggle_window)
            hk = SystemHotkey()
            hk.register(self.config["hide_hotkey"], callback=lambda x: self.show_hotkey.emit())

        self.shortcut = QShortcut(QKeySequence(self.config["close_hotkey"]), self)
        self.shortcut.activated.connect(self.app_close)

    def check_token(self):
        global restart
        # query = self.webview.history().currentItem().url().query()
        # print([i.url() for i in self.webview.history().items()])
        print(self.webview.url().url())
        self.webview.page().runJavaScript("while (i < 10000000) {i++};")
        if "access_token=" in self.webview.url().url():
            print("YAAAYYY!!! TOKEN!", self.webview.url().url().split("access_token=", 1)[1].split("&token_type")[0])
            self.config["token"] = self.webview.url().url().split("access_token=", 1)[1].split("&token_type")[0]
            self.save_config()
            restart = True
            self.app_close()

    def toggle_window(self):
        self.showed ^= True
        self.setWindowFlag(Qt.WindowTransparentForInput, not self.showed)
        self.webview.page().runJavaScript(f"document.body.classList.{'remove' if self.showed else 'add'}('hidden')")
        self.showNormal()

    @pyqtSlot(result=QVariant)
    def get_playlists(self):
        return to_qvariant(ya_music.users_playlists_list())

    @pyqtSlot(str, bool, result=QVariant)
    def load_playlist(self, playlist, play):
        if playlist == "Favorites" and play:
            self.queue = self.get_favorite_playlist().value()
            return QVariant(self.queue)
        elif playlist == "Favorites":
            return QVariant(self.get_favorite_playlist().value())
        tracks = list(map(lambda x: x.track_id, ya_music.playlists_list(playlist)[0].fetch_tracks()))
        if len(tracks) == 0:
            self.queue = []
            self.queue_position = 0
            return QVariant(self.queue)
        tmp = []
        for track in ya_music.tracks(tracks):
            if not track.available:
                continue
            tmp.append(track.track_id)
            if track.track_id in tracks_cache:
                continue
            artists = [artist.name for artist in track.artists]
            tracks_cache[track.track_id] = {"title": track.title, "artists": ", ".join(artists),
                                            "cover_url": track.get_cover_url("")}

        if play:
            self.queue = [{**tracks_cache[track], "track_id": track} for track in tmp]
            self.queue_position = 0
            return QVariant(self.queue)
        else:
            return QVariant([{**tracks_cache[track], "track_id": track} for track in tmp])

    @pyqtSlot(result=QVariant)
    def get_favorite_playlist(self):
        favorites = []
        for track in ya_music.users_likes_tracks().fetch_tracks():
            if not track.available:
                continue
            favorites.append(track.track_id)
            if track.track_id in tracks_cache:
                continue
            # track = track.fetch_track()
            # print(track.track_id)
            artists = [artist.name for artist in track.artists]
            tracks_cache[track.track_id] = {"title": track.title, "artists": ", ".join(artists),
                                            "cover_url": track.get_cover_url("")}
            # print(tracks_cache[track.track_id])

        result = [{**tracks_cache[track], "track_id": track} for track in favorites]
        return QVariant(result)

    @pyqtSlot()
    def clear_queue(self):
        self.queue.clear()
        self.queue_position = 0

    @pyqtSlot(str, result=QVariant)
    def add_track_to_queue(self, track_id):
        track = {**tracks_cache[track_id], "track_id": track_id}
        self.queue.append(track)
        return QVariant(track)

    @pyqtSlot(int, int, result=QVariant)
    def reorder_track_in_queue(self, index_from, index_to):
        track = self.queue[index_from]
        self.queue.pop(index_from)
        self.queue.insert(index_to, track)
        if index_from == self.queue_position:
            self.queue_position = index_to
        elif index_from < self.queue_position <= index_to:
            self.queue_position -= 1
        elif index_to <= self.queue_position <= index_from:
            self.queue_position += 1
        current_track = self.queue[self.queue_position]
        next_track = self.queue[self.queue_position + 1] if self.queue_position + 1 < len(self.queue) else None
        return QVariant([self.queue_position, current_track, next_track])

    @pyqtSlot(result=int)
    def get_current_index_queue(self):
        return self.queue_position

    @pyqtSlot(int, result=QVariant)
    def set_current_index_queue(self, index):
        self.queue_position = index
        current_track = self.queue[self.queue_position]
        next_track = self.queue[self.queue_position + 1] if self.queue_position + 1 < len(self.queue) else None
        return QVariant([self.queue_position, current_track, next_track])

    @pyqtSlot(result=QVariant)
    def prev_track(self):
        self.queue_position = max(self.queue_position - 1, 0)
        current_track = self.queue[self.queue_position]
        next_track = self.queue[self.queue_position + 1] if self.queue_position + 1 < len(self.queue) else None
        return QVariant([self.queue_position, current_track, next_track])

    @pyqtSlot(result=QVariant)
    def next_track(self):
        self.queue_position = min(self.queue_position + 1, len(self.queue) - 1)
        current_track = self.queue[self.queue_position]
        next_track = self.queue[self.queue_position + 1] if self.queue_position + 1 < len(self.queue) else None
        return QVariant([self.queue_position, current_track, next_track])

    @pyqtSlot(result=QVariant)
    def get_queue(self):
        if len(self.queue) == 0:
            self.queue = self.get_favorite_playlist().value()
        # if len(self.queue) < offset + count:
        #     self.queue.extend(self.get_favorite_playlist(max(offset, len(self.queue)), offset + count).value())
        # print(self.queue[offset:offset+count])
        return QVariant(self.queue)

    @pyqtSlot(str, result=str)
    def load_track(self, track_id):
        path = os.path.abspath(f"./cache/{track_id.replace(':', '_')}.mp3")
        if not os.path.exists(path):
            print(path)
            ya_music.tracks([track_id])[0].download(path, bitrate_in_kbps=320)
        return path

    @pyqtSlot()
    def preload_track(self):
        if self.queue_position + 1 < len(self.queue):
            track_id = self.queue[self.queue_position + 1]["track_id"]
            path = os.path.abspath(f"./cache/{track_id.replace(':', '_')}.mp3")
            if not os.path.exists(path):
                print("Preload:", path)
                self.preload_track_signal.emit(track_id, path)

    @pyqtSlot(str, result=QVariant)
    def get_track_lyrics(self, track_id):
        track = ya_music.tracks([track_id])[0]
        if not track.lyrics_info.has_available_sync_lyrics:
            return QVariant({"supported": False})

        result = []
        for line in track.get_lyrics("LRC").fetch_lyrics().splitlines():
            line_time, text = line.split(" ", 1)
            minutes, seconds = line_time[1:-1].split(":")
            result.append([int(minutes)*60 + float(seconds), text])
        return QVariant({"supported": True, "lyrics": result})

    @pyqtSlot(str, result=str)
    def load_resource(self, path: str):
        # if not path.startswith("icons/"):
        #     print(f"Get: ./ui/{path}")
        try:
            with open(f"./ui/{path}", "r", encoding="utf-8") as file:
                content = file.read()
        except PermissionError:
            print("Permission Error")
            content = ""
        return content

    @pyqtSlot(result=float)
    def get_volume(self):
        return self.config["volume"]

    @pyqtSlot(float)
    def set_volume(self, volume):
        self.config["volume"] = volume
        self.save_config()

    def save_config(self):
        with open("config.json", "w") as file:
            json.dump(self.config, file)

    @pyqtSlot(result=str)
    def app_close(self):
        self.close()
        dev_window.close()
        return "ok"

    @pyqtSlot()
    def app_minimize(self):
        self.showMinimized()


def excepthook(exc_type, exc_value, exc_tb):
    tb = "".join(traceback.format_exception(exc_type, exc_value, exc_tb))
    print(tb)
    QApplication.quit()


sys.excepthook = excepthook
# sys.stdout = ErrorFilter([r"\[.+:ERROR:CONSOLE\(64\)\] \"console\.assert\", source: devtools:\/\/devtools\/bundled\/sdk\/CSSModel\.js \(64\)"], sys.stdout)

if __name__ == "__main__":
    os.environ["QTWEBENGINE_CHROMIUM_FLAGS"] = "--enable-smooth-scrolling"
    app = QApplication(sys.argv)

    window = MainWindow(1.25)
    window.show()

    if window.config["debug"]:
        dev_window = DevWindow(1.25, window)
        dev_window.show()

    app.exec_()
    print(restart)

    if restart:
        os.startfile("\"Simple Ya.Music.exe\"")

    sys.exit()
    # with loop:
    #     loop.run_forever()
