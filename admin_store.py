"""Validation and local reporting for the prototype admin."""

from datetime import date, datetime
from urllib.parse import urlsplit
import re
import uuid


KINDS = {"streams", "recordings", "streamers", "products"}
PRODUCT_TYPES = {"hotel", "transport", "car", "tour", "other"}
STREAM_STATUSES = {"planned", "live", "finished"}
CURRENCIES = {"RUB", "USD", "EUR"}
TUTU_DEEPLINK_SCHEME = re.compile(r"^tutu[a-z0-9+.-]*$", re.IGNORECASE)


def string(body, key, maximum, required=False):
    value = body.get(key, "")
    if not isinstance(value, str):
        raise ValueError("Некорректное поле: " + key)
    value = value.strip()
    if len(value) > maximum or (required and not value):
        raise ValueError("Проверьте поле: " + key)
    return value


def url(body, key, required=False, local_media=False):
    value = string(body, key, 2000, required)
    if not value:
        return ""
    if local_media and re.fullmatch(r"/media/[a-f0-9]{32}\.(mp4|webm|png|jpe?g|webp)", value):
        return value
    parsed = urlsplit(value)
    if parsed.scheme != "https" or not parsed.netloc:
        raise ValueError("Ссылка должна начинаться с https://")
    return value


def offer_url(value):
    parsed = urlsplit(value.strip())
    is_web = parsed.scheme == "https" and bool(parsed.netloc)
    is_tutu_deeplink = bool(TUTU_DEEPLINK_SCHEME.fullmatch(parsed.scheme)) and bool(parsed.netloc or parsed.path)
    if not (is_web or is_tutu_deeplink):
        raise ValueError("Ссылка оффера должна быть https:// или диплинком Туту")
    return value.strip()


def optional_date(body, key):
    value = string(body, key, 40)
    if value:
        try:
            datetime.fromisoformat(value.replace("Z", "+00:00"))
        except ValueError as error:
            raise ValueError("Укажите корректную дату") from error
    return value


def optional_number(body, key, required=False):
    value = body.get(key)
    if value in (None, ""):
        if required:
            raise ValueError("Укажите цену")
        return None
    try:
        number = float(value)
    except (ValueError, TypeError) as error:
        raise ValueError("Укажите корректную цену") from error
    if number < 0 or number > 100000000:
        raise ValueError("Цена вне допустимого диапазона")
    return round(number, 2)


def validate_entity(kind, body, state, previous=None):
    if kind not in KINDS or not isinstance(body, dict):
        raise ValueError("Неизвестный раздел")
    data = {**(previous or {}), **body}
    now = datetime.now().astimezone().isoformat(timespec="seconds")
    item = {"id": (previous or {}).get("id", uuid.uuid4().hex),
            "createdAt": (previous or {}).get("createdAt", now), "updatedAt": now}

    if kind == "streamers":
        item.update(name=string(data, "name", 120, True), email=string(data, "email", 254, True).lower(),
                    phone=string(data, "phone", 40), description=string(data, "description", 1000),
                    avatarUrl=url(data, "avatarUrl", local_media=True),
                    externalId=string(data, "externalId", 120), profileUrl=url(data, "profileUrl"))
        if not re.fullmatch(r"[^\s@]+@[^\s@]+\.[^\s@]+", item["email"]):
            raise ValueError("Укажите корректный e-mail")
        if any(other["email"] == item["email"] and other["id"] != item["id"] for other in state["streamers"]):
            raise ValueError("Автор с таким e-mail уже есть")

    elif kind == "products":
        item.update(sku=string(data, "sku", 80, True), title=string(data, "title", 160, True),
                    type=string(data, "type", 20, True), currency=string(data, "currency", 3, True),
                    price=optional_number(data, "price", True), salePrice=optional_number(data, "salePrice"),
                    url=url(data, "url", required=True), imageUrl=url(data, "imageUrl", local_media=True),
                    description=string(data, "description", 2000), brand=string(data, "brand", 300),
                    usage=string(data, "usage", 1000), active=data.get("active", True))
        if item["type"] not in PRODUCT_TYPES or item["currency"] not in CURRENCIES or type(item["active"]) is not bool:
            raise ValueError("Проверьте тип, валюту и статус товара")
        if item["salePrice"] is not None and item["salePrice"] > item["price"]:
            raise ValueError("Цена со скидкой выше обычной")
        if any(other["sku"] == item["sku"] and other["id"] != item["id"] for other in state["products"]):
            raise ValueError("Товар с таким артикулом уже есть")

    elif kind == "streams":
        item.update(title=string(data, "title", 160, True), description=string(data, "description", 1000),
                    status=string(data, "status", 20, True), startAt=optional_date(data, "startAt"),
                    playbackUrl=url(data, "playbackUrl"), streamerId=string(data, "streamerId", 64))
        if item["status"] not in STREAM_STATUSES:
            raise ValueError("Неизвестный статус стрима")
        if item["streamerId"] and not any(x["id"] == item["streamerId"] for x in state["streamers"]):
            raise ValueError("Автор не найден")

    elif kind == "recordings":
        item.update(title=string(data, "title", 160, True), description=string(data, "description", 1000),
                    videoUrl=url(data, "videoUrl", required=True, local_media=True),
                    streamId=string(data, "streamId", 64), active=data.get("active", True))
        if type(item["active"]) is not bool:
            raise ValueError("Некорректный статус записи")
        if item["streamId"] and not any(x["id"] == item["streamId"] for x in state["streams"]):
            raise ValueError("Стрим не найден")
    return item


def can_delete(kind, item_id, state):
    if kind == "streamers":
        return not any(x.get("streamerId") == item_id for x in state["streams"] + state["videos"])
    if kind == "streams":
        return not any(x.get("streamId") == item_id for x in state["recordings"])
    if kind == "products":
        for video in state["videos"] + list(state["overrides"].values()):
            if any(offer.get("productId") == item_id for offer in video.get("offers", [])):
                return False
    return True


def report(state, start, end, seed_count):
    try:
        first, last = date.fromisoformat(start), date.fromisoformat(end)
    except ValueError as error:
        raise ValueError("Проверьте даты отчёта") from error
    if first > last or (last - first).days > 366:
        raise ValueError("Период не должен превышать 366 дней")
    events = [item for item in state["events"] if start <= item["at"][:10] <= end]
    totals = {name: sum(item["type"] == name for item in events) for name in ("view", "like", "offer_click", "watch_tick")}
    daily = {}
    by_video = {}
    for item in events:
        day = daily.setdefault(item["at"][:10], {"view": 0, "like": 0, "offer_click": 0, "watch_tick": 0})
        day[item["type"]] += 1
        video = by_video.setdefault(item["videoId"], {"view": 0, "like": 0, "offer_click": 0})
        if item["type"] in video:
            video[item["type"]] += 1
    return {"from": start, "to": end, "totalVideos": seed_count + len(state["videos"]),
            "publishedVideos": seed_count - len(state["hiddenIds"]) + sum(x.get("active", True) for x in state["videos"]),
            "views": totals["view"], "likes": totals["like"], "offerClicks": totals["offer_click"],
            "watchSeconds": totals["watch_tick"] * 5, "daily": daily, "byVideo": by_video}
