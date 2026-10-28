"""Local feed preview and admin API. Bind to loopback only; no authentication."""

from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import parse_qs, unquote, urlsplit
import json
import mimetypes
import os
import re
import threading
import uuid
from datetime import date, datetime

from admin_store import KINDS, can_delete, report, validate_entity


ROOT = Path(__file__).resolve().parent
DATA = ROOT / ".local-data"
UPLOADS = DATA / "uploads"
STATE_FILE = DATA / "state.json"
LOCK = threading.Lock()
MAX_VIDEO = 150 * 1024 * 1024
MAX_JSON = 64 * 1024
VIDEO_TYPES = {".mp4": "video/mp4", ".webm": "video/webm"}
IMAGE_TYPES = {".png": "image/png", ".jpg": "image/jpeg", ".jpeg": "image/jpeg", ".webp": "image/webp"}
MEDIA_TYPES = {**VIDEO_TYPES, **IMAGE_TYPES}
SEED_IDS = set(re.findall(r'\bid:\s*"([A-Za-z0-9]{10,64})"', (ROOT / "feed-data.js").read_text(encoding="utf-8")))


def read_state():
    if not STATE_FILE.exists():
        return {"enabled": True, "hiddenIds": [], "overrides": {}, "videos": [],
                "streams": [], "recordings": [], "streamers": [], "products": [], "events": []}
    with STATE_FILE.open(encoding="utf-8") as handle:
        state = json.load(handle)
    return {"enabled": state.get("enabled", True),
            "hiddenIds": state.get("hiddenIds", []),
            "overrides": state.get("overrides", {}),
            "videos": state.get("videos", []),
            "streams": state.get("streams", []),
            "recordings": state.get("recordings", []),
            "streamers": state.get("streamers", []),
            "products": state.get("products", []),
            "events": state.get("events", [])}


def write_state(state):
    DATA.mkdir(exist_ok=True)
    temp = DATA / ("state-" + uuid.uuid4().hex + ".tmp")
    with temp.open("w", encoding="utf-8") as handle:
        json.dump(state, handle, ensure_ascii=False, indent=2)
    os.replace(temp, STATE_FILE)


def enriched_video(video, products, streamers):
    """Resolve linked catalog products without rewriting stored video data."""
    result = {**video}
    streamer = next((item for item in streamers if item["id"] == video.get("streamerId")), None)
    if streamer:
        result["streamerName"] = streamer["name"]
        result["streamerAvatar"] = streamer["avatarUrl"]
    if "offers" not in video:
        return result
    result["offers"] = []
    by_id = {item["id"]: item for item in products}
    for offer in video.get("offers", [])[:1]:
        product = by_id.get(offer.get("productId"))
        if product:
            price = product["salePrice"] if product["salePrice"] is not None else product["price"]
            formatted = f"{price:g}".replace(".", ",") + " " + product["currency"]
            result["offers"].append({**offer, "title": product["title"], "price": formatted, "type": product["type"],
                                     "label": product["description"] or product["title"],
                                     "image": product["imageUrl"] or None, "href": product["url"]})
        else:
            result["offers"].append(offer)
    return result


class Handler(SimpleHTTPRequestHandler):
    def __init__(self, *args, **kwargs):
        super().__init__(*args, directory=str(ROOT), **kwargs)

    def end_headers(self):
        if not urlsplit(self.path).path.startswith("/media/"):
            self.send_header("Cache-Control", "no-store")
        super().end_headers()

    def json_response(self, status, payload):
        body = json.dumps(payload, ensure_ascii=False).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        self.send_header("Cache-Control", "no-store")
        self.end_headers()
        self.wfile.write(body)

    def error_response(self, status, message):
        self.json_response(status, {"error": message})

    def read_json(self):
        try:
            length = int(self.headers.get("Content-Length", "0"))
        except ValueError:
            length = 0
        if not 0 < length <= MAX_JSON:
            raise ValueError("Некорректный размер запроса")
        try:
            value = json.loads(self.rfile.read(length))
        except (ValueError, UnicodeDecodeError) as error:
            raise ValueError("Некорректный JSON") from error
        if not isinstance(value, dict):
            raise ValueError("Ожидался объект JSON")
        return value

    def do_GET(self):
        path = urlsplit(self.path).path
        if path == "/api/state":
            with LOCK:
                state = read_state()
            state.pop("events")
            state["videos"] = [enriched_video(item, state["products"], state["streamers"]) for item in state["videos"]]
            state["overrides"] = {key: enriched_video(item, state["products"], state["streamers"]) for key, item in state["overrides"].items()}
            return self.json_response(200, state)
        if path == "/api/reports":
            query = parse_qs(urlsplit(self.path).query)
            today = date.today().isoformat()
            try:
                with LOCK:
                    result = report(read_state(), query.get("from", [today[:8] + "01"])[0],
                                    query.get("to", [today])[0], len(SEED_IDS))
            except ValueError as error:
                return self.error_response(400, str(error))
            return self.json_response(200, result)
        if path.startswith("/media/"):
            return self.serve_media(path.removeprefix("/media/"))
        if path.startswith("/api/") or any(part.startswith(".") for part in Path(unquote(path)).parts):
            return self.send_error(404)
        return super().do_GET()

    def do_HEAD(self):
        path = urlsplit(self.path).path
        if path.startswith("/media/"):
            return self.serve_media(path.removeprefix("/media/"), head_only=True)
        if path.startswith("/api/") or any(part.startswith(".") for part in Path(unquote(path)).parts):
            return self.send_error(404)
        return super().do_HEAD()

    def do_POST(self):
        path = urlsplit(self.path).path
        if path == "/api/upload":
            return self.upload_video()
        if path == "/api/image-upload":
            return self.upload_image()
        if path == "/api/events":
            return self.record_event()
        kind = path.removeprefix("/api/")
        if kind in KINDS:
            try:
                body = self.read_json()
                with LOCK:
                    state = read_state()
                    item = validate_entity(kind, body, state)
                    state[kind].append(item)
                    write_state(state)
            except ValueError as error:
                return self.error_response(400, str(error))
            return self.json_response(201, item)
        if path != "/api/videos":
            return self.error_response(404, "Не найдено")
        try:
            body = self.read_json()
            video = self.validate_video(body)
        except ValueError as error:
            return self.error_response(400, str(error))
        with LOCK:
            state = read_state()
            if video["id"] in SEED_IDS or any(item.get("id") == video["id"] for item in state["videos"]):
                return self.error_response(409, "Ролик уже добавлен")
            state["videos"].append(video)
            write_state(state)
        return self.json_response(201, video)

    def do_PUT(self):
        if urlsplit(self.path).path != "/api/settings":
            return self.error_response(404, "Не найдено")
        try:
            enabled = self.read_json()["enabled"]
            if type(enabled) is not bool:
                raise ValueError("Нужно указать enabled: true или false")
        except (KeyError, ValueError) as error:
            return self.error_response(400, str(error))
        with LOCK:
            state = read_state()
            state["enabled"] = enabled
            write_state(state)
        return self.json_response(200, {"enabled": enabled})

    def do_PATCH(self):
        path = urlsplit(self.path).path
        generic = re.fullmatch(r"/api/(streams|recordings|streamers|products)/([a-f0-9]{32})", path)
        if generic:
            kind, item_id = generic.groups()
            try:
                body = self.read_json()
                with LOCK:
                    state = read_state()
                    previous = next((item for item in state[kind] if item["id"] == item_id), None)
                    if previous is None:
                        return self.error_response(404, "Запись не найдена")
                    item = validate_entity(kind, body, state, previous)
                    state[kind] = [item if existing["id"] == item_id else existing for existing in state[kind]]
                    write_state(state)
            except ValueError as error:
                return self.error_response(400, str(error))
            return self.json_response(200, item)
        match = re.fullmatch(r"/api/(videos|seed)/([A-Za-z0-9-]{10,64})", path)
        if not match:
            return self.error_response(404, "Не найдено")
        try:
            body = self.read_json()
            allowed = {"active", "title", "text", "offers", "category", "tags", "streamerId", "posterUrl"}
            if not body or set(body) - allowed:
                raise ValueError("Неизвестные поля видео")
            if "active" in body and type(body["active"]) is not bool:
                raise ValueError("Нужно указать active: true или false")
            updates = self.validate_metadata(body) if set(body) - {"active"} else {}
        except ValueError as error:
            return self.error_response(400, str(error))
        kind, video_id = match.groups()
        with LOCK:
            state = read_state()
            if kind == "seed":
                if video_id not in SEED_IDS:
                    return self.error_response(404, "Ролик не найден")
                if "active" in body:
                    hidden = set(state["hiddenIds"])
                    hidden.discard(video_id) if body["active"] else hidden.add(video_id)
                    state["hiddenIds"] = sorted(hidden)
                if updates:
                    state["overrides"].setdefault(video_id, {}).update(updates)
            else:
                target = next((item for item in state["videos"] if item["id"] == video_id), None)
                if target is None:
                    return self.error_response(404, "Ролик не найден")
                if "active" in body:
                    target["active"] = body["active"]
                target.update(updates)
            write_state(state)
        return self.json_response(200, {"id": video_id, "updated": list(body)})

    def do_DELETE(self):
        generic = re.fullmatch(r"/api/(streams|recordings|streamers|products)/([a-f0-9]{32})", urlsplit(self.path).path)
        if generic:
            kind, item_id = generic.groups()
            with LOCK:
                state = read_state()
                if not any(item["id"] == item_id for item in state[kind]):
                    return self.error_response(404, "Запись не найдена")
                if not can_delete(kind, item_id, state):
                    return self.error_response(409, "Сначала удалите связанные записи")
                state[kind] = [item for item in state[kind] if item["id"] != item_id]
                write_state(state)
            return self.json_response(200, {"deleted": item_id})
        match = re.fullmatch(r"/api/videos/([A-Za-z0-9-]{10,64})", urlsplit(self.path).path)
        if not match:
            return self.error_response(404, "Не найдено")
        video_id = match.group(1)
        with LOCK:
            state = read_state()
            before = len(state["videos"])
            state["videos"] = [item for item in state["videos"] if item["id"] != video_id]
            if len(state["videos"]) == before:
                return self.error_response(404, "Ролик не найден")
            write_state(state)
        return self.json_response(200, {"deleted": video_id})

    def validate_video(self, body):
        source = body.get("source")
        video_id = str(body.get("id", ""))
        if source == "kinescope":
            if not re.fullmatch(r"[A-Za-z0-9]{10,64}", video_id):
                raise ValueError("Укажите корректный ID Кинескопа")
        elif source == "upload":
            video_id = uuid.uuid4().hex
            media_url = body.get("mediaUrl", "")
            filename = media_url.removeprefix("/media/")
            if not re.fullmatch(r"[a-f0-9]{32}\.(mp4|webm)", filename) or not (UPLOADS / filename).is_file():
                raise ValueError("Сначала загрузите видеофайл")
        else:
            raise ValueError("Неизвестный источник видео")
        metadata = self.validate_metadata(body, required=True)
        video = {"id": video_id, "source": source, **metadata, "active": True}
        if source == "upload":
            video["mediaUrl"] = body["mediaUrl"]
        return video

    def validate_metadata(self, body, required=False):
        result = {}
        for key, maximum in (("title", 120), ("text", 1000), ("category", 80), ("streamerId", 64)):
            if key in body or (required and key == "title"):
                value = body.get(key, "")
                if not isinstance(value, str) or len(value.strip()) > maximum or (key == "title" and not value.strip()):
                    raise ValueError("Проверьте название и описание видео")
                result[key] = value.strip()
        if required and "text" not in result:
            result["text"] = result["title"]
        if "tags" in body or required:
            tags = body.get("tags", [])
            if not isinstance(tags, list) or len(tags) > 10 or any(not isinstance(tag, str) or not tag.strip() or len(tag.strip()) > 40 for tag in tags):
                raise ValueError("Можно добавить до 10 тегов")
            result["tags"] = [tag.strip() for tag in tags]
        if "posterUrl" in body:
            poster = body["posterUrl"]
            if not isinstance(poster, str) or len(poster) > 2000 or (poster and not (re.fullmatch(r"/media/[a-f0-9]{32}\.(png|jpe?g|webp)", poster) or (urlsplit(poster).scheme == "https" and urlsplit(poster).netloc))):
                raise ValueError("Укажите корректный постер")
            result["posterUrl"] = poster
        if "offers" in body or required:
            offers = body.get("offers", [])
            if not isinstance(offers, list) or len(offers) > 1:
                raise ValueError("Можно добавить не больше одного оффера")
            valid = []
            for offer in offers:
                if not isinstance(offer, dict):
                    raise ValueError("Некорректный оффер")
                title, price, href = offer.get("title"), offer.get("price", ""), offer.get("href")
                if not isinstance(title, str) or not title.strip() or len(title.strip()) > 100 or not isinstance(price, str) or len(price.strip()) > 80 or not isinstance(href, str):
                    raise ValueError("Проверьте название, цену и ссылку оффера")
                parsed = urlsplit(href.strip())
                if parsed.scheme != "https" or not parsed.netloc:
                    raise ValueError("Ссылка оффера должна начинаться с https://")
                label = offer.get("label", title)
                image = offer.get("image")
                if not isinstance(label, str) or len(label) > 1000:
                    raise ValueError("Некорректное описание оффера")
                if image is not None and (not isinstance(image, str) or len(image) > 2000 or urlsplit(image).scheme != "https"):
                    raise ValueError("Некорректное изображение оффера")
                product_id = offer.get("productId", "")
                if not isinstance(product_id, str) or (product_id and not re.fullmatch(r"[a-f0-9]{32}", product_id)):
                    raise ValueError("Некорректный товар")
                valid.append({"title": title.strip(), "price": price.strip(), "label": label.strip(), "image": image, "href": href.strip(), "productId": product_id})
            result["offers"] = valid
        return result

    def upload_video(self):
        try:
            size = int(self.headers.get("Content-Length", "0"))
        except ValueError:
            size = 0
        if not 0 < size <= MAX_VIDEO:
            return self.error_response(413, "Файл должен быть меньше 150 МБ")
        query = parse_qs(urlsplit(self.path).query)
        suffix = Path(query.get("filename", [""])[0]).suffix.lower()
        if suffix not in VIDEO_TYPES:
            return self.error_response(415, "Поддерживаются MP4 и WebM")
        UPLOADS.mkdir(parents=True, exist_ok=True)
        filename = uuid.uuid4().hex + suffix
        target = UPLOADS / filename
        remaining = size
        try:
            with target.open("wb") as handle:
                while remaining:
                    chunk = self.rfile.read(min(1024 * 1024, remaining))
                    if not chunk:
                        raise ConnectionError("Передача файла прервалась")
                    handle.write(chunk)
                    remaining -= len(chunk)
        except (OSError, ConnectionError):
            target.unlink(missing_ok=True)
            return self.error_response(400, "Не удалось загрузить файл")
        return self.json_response(201, {"mediaUrl": "/media/" + filename})

    def upload_image(self):
        try:
            size = int(self.headers.get("Content-Length", "0"))
        except ValueError:
            size = 0
        if not 0 < size <= 10 * 1024 * 1024:
            return self.error_response(413, "Изображение должно быть меньше 10 МБ")
        query = parse_qs(urlsplit(self.path).query)
        suffix = Path(query.get("filename", [""])[0]).suffix.lower()
        if suffix not in IMAGE_TYPES:
            return self.error_response(415, "Поддерживаются PNG, JPEG и WebP")
        content = self.rfile.read(size)
        signatures = {".png": content.startswith(b"\x89PNG\r\n\x1a\n"),
                      ".jpg": content.startswith(b"\xff\xd8\xff"),
                      ".jpeg": content.startswith(b"\xff\xd8\xff"),
                      ".webp": content.startswith(b"RIFF") and content[8:12] == b"WEBP"}
        if len(content) != size or not signatures[suffix]:
            return self.error_response(400, "Формат изображения не совпадает с файлом")
        UPLOADS.mkdir(parents=True, exist_ok=True)
        filename = uuid.uuid4().hex + suffix
        (UPLOADS / filename).write_bytes(content)
        return self.json_response(201, {"mediaUrl": "/media/" + filename})

    def record_event(self):
        try:
            body = self.read_json()
            event_type = body.get("type")
            video_id = body.get("videoId")
            if event_type not in {"view", "like", "offer_click", "watch_tick"} or not isinstance(video_id, str):
                raise ValueError("Некорректное событие")
            with LOCK:
                state = read_state()
                if video_id not in SEED_IDS and not any(item["id"] == video_id for item in state["videos"]):
                    return self.error_response(404, "Ролик не найден")
                state["events"].append({"type": event_type, "videoId": video_id,
                                        "at": datetime.now().astimezone().isoformat(timespec="seconds")})
                state["events"] = state["events"][-50000:]
                write_state(state)
        except ValueError as error:
            return self.error_response(400, str(error))
        return self.json_response(201, {"saved": True})

    def serve_media(self, filename, head_only=False):
        if not re.fullmatch(r"[a-f0-9]{32}\.(mp4|webm|png|jpe?g|webp)", filename):
            return self.send_error(404)
        target = UPLOADS / filename
        if not target.is_file():
            return self.send_error(404)
        size = target.stat().st_size
        start, end = 0, size - 1
        partial = False
        range_header = self.headers.get("Range", "")
        if range_header:
            match = re.fullmatch(r"bytes=(\d*)-(\d*)", range_header)
            if not match or not any(match.groups()):
                return self.send_error(416)
            if match.group(1):
                start = int(match.group(1))
                end = min(int(match.group(2)), size - 1) if match.group(2) else size - 1
            else:
                suffix = int(match.group(2))
                if suffix == 0:
                    return self.send_error(416)
                start = max(0, size - suffix)
                end = size - 1
            if start > end or start >= size:
                return self.send_error(416)
            partial = True
        self.send_response(206 if partial else 200)
        self.send_header("Content-Type", MEDIA_TYPES[target.suffix])
        self.send_header("Content-Length", str(end - start + 1))
        self.send_header("Accept-Ranges", "bytes")
        self.send_header("Cache-Control", "public, max-age=31536000, immutable")
        if partial:
            self.send_header("Content-Range", f"bytes {start}-{end}/{size}")
        self.end_headers()
        if head_only:
            return
        with target.open("rb") as handle:
            handle.seek(start)
            remaining = end - start + 1
            try:
                while remaining:
                    chunk = handle.read(min(1024 * 1024, remaining))
                    if not chunk:
                        break
                    self.wfile.write(chunk)
                    remaining -= len(chunk)
            except (BrokenPipeError, ConnectionResetError):
                pass


if __name__ == "__main__":
    import argparse
    parser = argparse.ArgumentParser()
    parser.add_argument("--port", type=int, default=8765)
    args = parser.parse_args()
    mimetypes.add_type("text/javascript", ".js")
    server = ThreadingHTTPServer(("127.0.0.1", args.port), Handler)
    print(f"Лента: http://127.0.0.1:{args.port}/", flush=True)
    print(f"Админка: http://127.0.0.1:{args.port}/admin.html", flush=True)
    server.serve_forever()
