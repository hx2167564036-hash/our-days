#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
二人生活记录 · 服务端
纯 Python 标准库实现（http.server + sqlite3），零第三方依赖。
运行：python3 server.py   （默认端口 8000，可用环境变量 PORT 覆盖）
"""
import os
import json
import sqlite3
import datetime
import mimetypes
import uuid
import hashlib
import secrets
import urllib.request
import urllib.parse
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

BASE_DIR = os.path.dirname(os.path.abspath(__file__))
STATIC_DIR = os.path.join(BASE_DIR, "static")
UPLOAD_DIR = os.path.join(STATIC_DIR, "uploads")
DB_PATH = os.environ.get("OURDAYS_DB") or os.path.join(BASE_DIR, "data.db")
PORT = int(os.environ.get("PORT", "8000"))

os.makedirs(UPLOAD_DIR, exist_ok=True)


# ---------------------------------------------------------------- 数据库
def get_db():
    conn = sqlite3.connect(DB_PATH)
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA journal_mode=WAL;")
    return conn


def init_db():
    conn = get_db()
    conn.executescript(
        """
        CREATE TABLE IF NOT EXISTS settings (
            key TEXT PRIMARY KEY,
            value TEXT
        );
        CREATE TABLE IF NOT EXISTS moments (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            author TEXT NOT NULL DEFAULT '',
            content TEXT NOT NULL DEFAULT '',
            mood TEXT DEFAULT '',
            image TEXT DEFAULT '',
            moment_date TEXT DEFAULT '',
            created_at TEXT NOT NULL
        );
        CREATE TABLE IF NOT EXISTS places (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            name TEXT NOT NULL,
            category TEXT DEFAULT '其他',
            address TEXT DEFAULT '',
            note TEXT DEFAULT '',
            wish_level INTEGER DEFAULT 3,
            status TEXT DEFAULT '想去',
            added_by TEXT DEFAULT '',
            lat REAL,
            lng REAL,
            created_at TEXT NOT NULL
        );
        CREATE TABLE IF NOT EXISTS activities (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            name TEXT NOT NULL,
            category TEXT DEFAULT '其他',
            note TEXT DEFAULT '',
            added_by TEXT DEFAULT '',
            created_at TEXT NOT NULL
        );
        CREATE TABLE IF NOT EXISTS anniversaries (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            name TEXT NOT NULL,
            date TEXT NOT NULL,
            is_yearly INTEGER DEFAULT 0,
            created_at TEXT NOT NULL
        );
        """
    )
    # 迁移：places 表增加经纬度字段
    cols = [r["name"] for r in conn.execute("PRAGMA table_info(places)").fetchall()]
    if "lat" not in cols:
        conn.execute("ALTER TABLE places ADD COLUMN lat REAL")
    if "lng" not in cols:
        conn.execute("ALTER TABLE places ADD COLUMN lng REAL")
    # 迁移：状态文案 已打卡 → 已去过
    conn.execute("UPDATE places SET status='已去过' WHERE status='已打卡'")
    # 默认设置
    defaults = {
        "name_a": "我",
        "name_b": "TA",
        "together_date": "",   # 在一起的日子 YYYY-MM-DD
        "passcode": "",        # 访问口令，空=不启用
    }
    for k, v in defaults.items():
        conn.execute("INSERT OR IGNORE INTO settings(key, value) VALUES(?, ?)", (k, v))
    # 口令盐（每次安装随机生成）
    conn.execute("INSERT OR IGNORE INTO settings(key, value) VALUES('passcode_salt', ?)", (secrets.token_hex(16),))
    conn.commit()
    conn.close()


# ---------------------------------------------------------------- 工具
def now_str():
    return datetime.datetime.now().strftime("%Y-%m-%d %H:%M:%S")


def today_str():
    return datetime.datetime.now().strftime("%Y-%m-%d")


def _to_float(v):
    if v is None or v == "":
        return None
    try:
        return float(v)
    except (TypeError, ValueError):
        return None


def parse_date(s):
    s = (s or "").strip()
    if not s:
        return None
    for fmt in ("%Y-%m-%d", "%Y/%m/%d", "%Y.%m.%d"):
        try:
            return datetime.datetime.strptime(s, fmt).date()
        except ValueError:
            continue
    return None


def days_since(date_str):
    d = parse_date(date_str)
    if not d:
        return None
    return (datetime.date.today() - d).days


def days_until_next(target_date_str, is_yearly):
    """计算到下一个纪念日的天数（支持每年重复）。"""
    d = parse_date(target_date_str)
    if not d:
        return None
    today = datetime.date.today()
    if is_yearly:
        # 找今年的纪念日，若已过则看明年
        try:
            this_year = d.replace(year=today.year)
        except ValueError:  # 2月29日等
            this_year = d.replace(year=today.year, day=28)
        if this_year < today:
            try:
                this_year = d.replace(year=today.year + 1)
            except ValueError:
                this_year = d.replace(year=today.year + 1, day=28)
        return (this_year - today).days
    else:
        return (d - today).days


# ---------------------------------------------------------------- 请求处理
class Handler(BaseHTTPRequestHandler):
    server_version = "OurDays/1.0"

    # ---- 基础响应 ----
    def _send_json(self, obj, status=200):
        body = json.dumps(obj, ensure_ascii=False).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        self.send_header("Cache-Control", "no-store")
        self.end_headers()
        self.wfile.write(body)

    def _send_error(self, msg, status=400):
        self._send_json({"ok": False, "error": msg}, status)

    def _read_body(self):
        length = int(self.headers.get("Content-Length", 0) or 0)
        return self.rfile.read(length) if length else b""

    def _read_json(self):
        try:
            return json.loads(self._read_body().decode("utf-8") or "{}")
        except Exception:
            return None

    # ---- 鉴权 ----
    def _cookies(self):
        out = {}
        for part in (self.headers.get("Cookie", "") or "").split(";"):
            if "=" in part:
                k, v = part.strip().split("=", 1)
                out[k.strip()] = v.strip()
        return out

    def _auth_info(self):
        conn = get_db()
        rows = conn.execute(
            "SELECT key, value FROM settings WHERE key IN ('passcode','passcode_salt')"
        ).fetchall()
        conn.close()
        d = {r["key"]: r["value"] for r in rows}
        return d.get("passcode", ""), d.get("passcode_salt", "")

    def _is_authed(self):
        pc, salt = self._auth_info()
        if not pc:
            return True
        expected = hashlib.sha256((pc + salt).encode()).hexdigest()
        return self._cookies().get("auth") == expected

    def _check_auth(self, path):
        """需要鉴权的路径，未登录则返回 401。返回 True 表示放行。"""
        need = path.startswith("/uploads/") or (
            path.startswith("/api/") and path not in ("/api/auth", "/api/login", "/api/logout")
        )
        if need and not self._is_authed():
            self._send_json({"ok": False, "error": "需要登录", "need_login": True}, 401)
            return False
        return True

    # ---- 静态文件 ----
    def _serve_static(self, path):
        if path == "/" or path == "":
            path = "/index.html"
        # 防目录穿越
        rel = path.lstrip("/")
        full = os.path.normpath(os.path.join(STATIC_DIR, rel))
        if not full.startswith(STATIC_DIR) or not os.path.isfile(full):
            self._send_error("Not Found", 404)
            return
        ctype = mimetypes.guess_type(full)[0] or "application/octet-stream"
        with open(full, "rb") as f:
            data = f.read()
        self.send_response(200)
        self.send_header("Content-Type", ctype)
        self.send_header("Content-Length", str(len(data)))
        self.send_header("Cache-Control", "no-cache")
        self.end_headers()
        self.wfile.write(data)

    # ---- multipart 解析（仅用于图片上传） ----
    def _parse_multipart(self, body, content_type):
        if "boundary=" not in content_type:
            return None, None
        boundary = content_type.split("boundary=")[1].split(";")[0].strip().strip('"')
        marker = b"--" + boundary.encode()
        parts = body.split(marker)
        for part in parts:
            if b"filename=" in part[:512]:
                header, _, data = part.partition(b"\r\n\r\n")
                data = data.rstrip(b"\r\n")
                filename = b""
                for h in header.split(b"\r\n"):
                    if b"filename=" in h:
                        filename = h.split(b"filename=")[1].strip().strip(b'"')
                        break
                return filename.decode("utf-8", "ignore"), data
        return None, None

    # ---- 路由 ----
    def do_GET(self):
        path = self.path.split("?")[0].rstrip("/") or "/"
        if path.startswith("/api/") or path.startswith("/uploads/"):
            if not self._check_auth(path):
                return
        if path.startswith("/api/"):
            self.handle_api_get(path)
        else:
            self._serve_static(self.path.split("?")[0])

    def do_POST(self):
        path = self.path.split("?")[0].rstrip("/") or "/"
        if not path.startswith("/api/"):
            self._send_error("Not Found", 404)
            return
        if path in ("/api/login", "/api/logout"):
            self.handle_api_post(path)
            return
        if not self._check_auth(path):
            return
        if path == "/api/upload":
            self.api_upload()
        else:
            self.handle_api_post(path)

    def do_PATCH(self):
        path = self.path.split("?")[0].rstrip("/") or "/"
        if not path.startswith("/api/"):
            self._send_error("Not Found", 404)
            return
        if not self._check_auth(path):
            return
        self.handle_api_patch(path)

    def do_DELETE(self):
        path = self.path.split("?")[0].rstrip("/") or "/"
        if not path.startswith("/api/"):
            self._send_error("Not Found", 404)
            return
        if not self._check_auth(path):
            return
        self.handle_api_delete(path)

    # ============ GET ============
    def handle_api_get(self, path):
        if path == "/api/overview":
            return self.api_overview()
        if path == "/api/auth":
            return self.api_auth()
        if path == "/api/export":
            return self.api_export()
        if path == "/api/geocode":
            return self.api_geocode()
        if path == "/api/settings":
            return self.api_get_settings()
        if path == "/api/moments":
            return self.api_list_moments()
        if path == "/api/places":
            return self.api_list_places()
        if path == "/api/activities":
            return self.api_list_activities()
        if path == "/api/anniversaries":
            return self.api_list_anniversaries()
        self._send_error("Not Found", 404)

    def api_overview(self):
        conn = get_db()
        settings = {r["key"]: r["value"] for r in conn.execute("SELECT * FROM settings")}
        together = days_since(settings.get("together_date", ""))
        anniversaries = []
        for r in conn.execute("SELECT * FROM anniversaries ORDER BY date"):
            d = parse_date(r["date"])
            if not d:
                continue
            days_left = days_until_next(r["date"], r["is_yearly"])
            anniversaries.append({
                "id": r["id"], "name": r["name"], "date": r["date"],
                "is_yearly": r["is_yearly"], "days_left": days_left,
            })
        anniversaries.sort(key=lambda x: (x["days_left"] is None, x["days_left"]))
        counts = {
            "moments": conn.execute("SELECT COUNT(*) c FROM moments").fetchone()["c"],
            "places": conn.execute("SELECT COUNT(*) c FROM places").fetchone()["c"],
            "places_done": conn.execute("SELECT COUNT(*) c FROM places WHERE status='已去过'").fetchone()["c"],
            "activities": conn.execute("SELECT COUNT(*) c FROM activities").fetchone()["c"],
        }
        conn.close()
        self._send_json({
            "ok": True,
            "settings": settings,
            "together_days": together,
            "anniversaries": anniversaries,
            "counts": counts,
            "today": today_str(),
        })

    def api_auth(self):
        pc, _ = self._auth_info()
        self._send_json({"ok": True, "need_login": bool(pc) and not self._is_authed()})

    def api_login(self):
        data = self._read_json() or {}
        pc, salt = self._auth_info()
        if not pc:
            return self._send_json({"ok": True, "need_login": False})
        if data.get("passcode") == pc:
            token = hashlib.sha256((pc + salt).encode()).hexdigest()
            body = json.dumps({"ok": True}, ensure_ascii=False).encode("utf-8")
            self.send_response(200)
            self.send_header("Content-Type", "application/json; charset=utf-8")
            self.send_header("Set-Cookie", f"auth={token}; Path=/; HttpOnly; Max-Age=2592000; SameSite=Lax")
            self.send_header("Content-Length", str(len(body)))
            self.end_headers()
            self.wfile.write(body)
            return
        self._send_json({"ok": False, "error": "口令不正确"}, 401)

    def api_logout(self):
        body = json.dumps({"ok": True}, ensure_ascii=False).encode("utf-8")
        self.send_response(200)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Set-Cookie", "auth=; Path=/; HttpOnly; Max-Age=0")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def api_geocode(self):
        qs = urllib.parse.parse_qs(urllib.parse.urlparse(self.path).query)
        q = (qs.get("q", [""])[0] or "").strip()
        if not q:
            return self._send_json({"ok": True, "items": []})
        url = "https://nominatim.openstreetmap.org/search?format=json&limit=5&q=" + urllib.parse.quote(q)
        req = urllib.request.Request(url, headers={"User-Agent": "OurDays/1.0 (couple life app)"})
        try:
            with urllib.request.urlopen(req, timeout=10) as resp:
                raw = resp.read().decode("utf-8")
            data = json.loads(raw)
        except Exception:
            return self._send_error("地理编码失败，请稍后再试", 502)
        items = []
        for d in data:
            if "lat" in d and "lon" in d:
                items.append({
                    "name": d.get("display_name", ""),
                    "lat": float(d["lat"]),
                    "lng": float(d["lon"]),
                })
        self._send_json({"ok": True, "items": items})

    def api_export(self):
        conn = get_db()
        def rows(sql):
            return [dict(r) for r in conn.execute(sql).fetchall()]
        data = {
            "app": "our-days",
            "exported_at": now_str(),
            "settings": {r["key"]: r["value"] for r in conn.execute("SELECT * FROM settings")},
            "anniversaries": rows("SELECT * FROM anniversaries"),
            "moments": rows("SELECT * FROM moments"),
            "places": rows("SELECT * FROM places"),
            "activities": rows("SELECT * FROM activities"),
        }
        conn.close()
        body = json.dumps(data, ensure_ascii=False, indent=2).encode("utf-8")
        self.send_response(200)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Disposition", "attachment; filename=our-days-backup.json")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def api_get_settings(self):
        conn = get_db()
        settings = {r["key"]: r["value"] for r in conn.execute("SELECT * FROM settings")}
        conn.close()
        self._send_json({"ok": True, "settings": settings})

    def api_list_moments(self):
        conn = get_db()
        rows = conn.execute("SELECT * FROM moments ORDER BY moment_date DESC, id DESC").fetchall()
        conn.close()
        self._send_json({"ok": True, "items": [dict(r) for r in rows]})

    def api_list_places(self):
        conn = get_db()
        status = None
        if "?" in self.path:
            from urllib.parse import parse_qs, urlparse
            qs = parse_qs(urlparse(self.path).query)
            status = qs.get("status", [None])[0]
        if status and status in ("想去", "已去过"):
            rows = conn.execute("SELECT * FROM places WHERE status=? ORDER BY id DESC", (status,)).fetchall()
        else:
            rows = conn.execute("SELECT * FROM places ORDER BY id DESC").fetchall()
        conn.close()
        self._send_json({"ok": True, "items": [dict(r) for r in rows]})

    def api_list_activities(self):
        conn = get_db()
        rows = conn.execute("SELECT * FROM activities ORDER BY id DESC").fetchall()
        conn.close()
        self._send_json({"ok": True, "items": [dict(r) for r in rows]})

    def api_list_anniversaries(self):
        conn = get_db()
        rows = conn.execute("SELECT * FROM anniversaries ORDER BY date").fetchall()
        conn.close()
        self._send_json({"ok": True, "items": [dict(r) for r in rows]})

    # ============ POST ============
    def handle_api_post(self, path):
        if path == "/api/login":
            return self.api_login()
        if path == "/api/logout":
            return self.api_logout()
        if path == "/api/settings":
            return self.api_save_settings()
        if path == "/api/moments":
            return self.api_add_moment()
        if path == "/api/places":
            return self.api_add_place()
        if path == "/api/activities":
            return self.api_add_activity()
        if path == "/api/anniversaries":
            return self.api_add_anniversary()
        self._send_error("Not Found", 404)

    def api_save_settings(self):
        data = self._read_json()
        if not isinstance(data, dict):
            return self._send_error("参数错误")
        allowed = ("name_a", "name_b", "together_date", "passcode")
        conn = get_db()
        for k in allowed:
            if k in data and isinstance(data[k], str):
                conn.execute(
                    "INSERT INTO settings(key,value) VALUES(?,?) "
                    "ON CONFLICT(key) DO UPDATE SET value=excluded.value",
                    (k, data[k]),
                )
        conn.commit()
        conn.close()
        self._send_json({"ok": True})

    def api_add_moment(self):
        data = self._read_json()
        if not isinstance(data, dict):
            return self._send_error("参数错误")
        content = (data.get("content") or "").strip()
        if not content and not data.get("image"):
            return self._send_error("写点什么或传张照片吧")
        conn = get_db()
        cur = conn.execute(
            "INSERT INTO moments(author, content, mood, image, moment_date, created_at) "
            "VALUES(?,?,?,?,?,?)",
            (
                data.get("author", ""),
                content,
                data.get("mood", ""),
                data.get("image", ""),
                data.get("moment_date") or today_str(),
                now_str(),
            ),
        )
        conn.commit()
        new_id = cur.lastrowid
        row = conn.execute("SELECT * FROM moments WHERE id=?", (new_id,)).fetchone()
        conn.close()
        self._send_json({"ok": True, "item": dict(row)})

    def api_add_place(self):
        data = self._read_json()
        if not isinstance(data, dict):
            return self._send_error("参数错误")
        name = (data.get("name") or "").strip()
        if not name:
            return self._send_error("请填写地点名称")
        try:
            wish_level = int(data.get("wish_level", 3))
        except (TypeError, ValueError):
            wish_level = 3
        wish_level = max(1, min(5, wish_level))
        lat = _to_float(data.get("lat"))
        lng = _to_float(data.get("lng"))
        conn = get_db()
        cur = conn.execute(
            "INSERT INTO places(name, category, address, note, wish_level, status, added_by, lat, lng, created_at) "
            "VALUES(?,?,?,?,?,?,?,?,?,?)",
            (
                name,
                data.get("category", "其他"),
                data.get("address", ""),
                data.get("note", ""),
                wish_level,
                "想去",
                data.get("added_by", ""),
                lat,
                lng,
                now_str(),
            ),
        )
        conn.commit()
        row = conn.execute("SELECT * FROM places WHERE id=?", (cur.lastrowid,)).fetchone()
        conn.close()
        self._send_json({"ok": True, "item": dict(row)})

    def api_add_activity(self):
        data = self._read_json()
        if not isinstance(data, dict):
            return self._send_error("参数错误")
        name = (data.get("name") or "").strip()
        if not name:
            return self._send_error("请填写活动名称")
        conn = get_db()
        cur = conn.execute(
            "INSERT INTO activities(name, category, note, added_by, created_at) VALUES(?,?,?,?,?)",
            (name, data.get("category", "其他"), data.get("note", ""), data.get("added_by", ""), now_str()),
        )
        conn.commit()
        row = conn.execute("SELECT * FROM activities WHERE id=?", (cur.lastrowid,)).fetchone()
        conn.close()
        self._send_json({"ok": True, "item": dict(row)})

    def api_add_anniversary(self):
        data = self._read_json()
        if not isinstance(data, dict):
            return self._send_error("参数错误")
        name = (data.get("name") or "").strip()
        date = (data.get("date") or "").strip()
        if not name or not date:
            return self._send_error("请填写名称和日期")
        conn = get_db()
        cur = conn.execute(
            "INSERT INTO anniversaries(name, date, is_yearly, created_at) VALUES(?,?,?,?)",
            (name, date, 1 if data.get("is_yearly") else 0, now_str()),
        )
        conn.commit()
        row = conn.execute("SELECT * FROM anniversaries WHERE id=?", (cur.lastrowid,)).fetchone()
        conn.close()
        self._send_json({"ok": True, "item": dict(row)})

    def api_upload(self):
        content_type = self.headers.get("Content-Type", "")
        body = self._read_body()
        filename, data = self._parse_multipart(body, content_type)
        if not data:
            return self._send_error("未收到图片")
        ext = os.path.splitext(filename)[1].lower()
        if ext not in (".jpg", ".jpeg", ".png", ".gif", ".webp", ".bmp"):
            ext = ".jpg"
        saved = uuid.uuid4().hex + ext
        with open(os.path.join(UPLOAD_DIR, saved), "wb") as f:
            f.write(data)
        self._send_json({"ok": True, "filename": saved, "url": "/uploads/" + saved})

    # ============ PATCH ============
    def handle_api_patch(self, path):
        if path.startswith("/api/moments/"):
            return self.api_patch_moment(path)
        if path.startswith("/api/places/"):
            return self.api_patch_place(path)
        if path.startswith("/api/activities/"):
            return self.api_patch_activity(path)
        if path.startswith("/api/anniversaries/"):
            return self.api_patch_anniversary(path)
        self._send_error("Not Found", 404)

    def api_patch_place(self, path):
        try:
            pid = int(path.rsplit("/", 1)[1])
        except (ValueError, IndexError):
            return self._send_error("参数错误")
        data = self._read_json() or {}
        conn = get_db()
        row = conn.execute("SELECT * FROM places WHERE id=?", (pid,)).fetchone()
        if not row:
            conn.close()
            return self._send_error("不存在", 404)
        # 可更新字段
        fields = {}
        for k in ("name", "category", "address", "note", "added_by", "status"):
            if k in data and isinstance(data[k], str):
                fields[k] = data[k]
        if "wish_level" in data:
            try:
                fields["wish_level"] = max(1, min(5, int(data["wish_level"])))
            except (TypeError, ValueError):
                pass
        for k in ("lat", "lng"):
            if k in data:
                fields[k] = _to_float(data[k])
        if fields:
            sets = ", ".join(f"{k}=?" for k in fields)
            conn.execute(f"UPDATE places SET {sets} WHERE id=?", (*fields.values(), pid))
            conn.commit()
        row = conn.execute("SELECT * FROM places WHERE id=?", (pid,)).fetchone()
        conn.close()
        self._send_json({"ok": True, "item": dict(row)})

    def api_patch_moment(self, path):
        try:
            pid = int(path.rsplit("/", 1)[1])
        except (ValueError, IndexError):
            return self._send_error("参数错误")
        data = self._read_json() or {}
        conn = get_db()
        row = conn.execute("SELECT * FROM moments WHERE id=?", (pid,)).fetchone()
        if not row:
            conn.close()
            return self._send_error("不存在", 404)
        fields = {}
        for k in ("author", "content", "mood", "image", "moment_date"):
            if k in data and isinstance(data[k], str):
                fields[k] = data[k]
        if fields:
            sets = ", ".join(f"{k}=?" for k in fields)
            conn.execute(f"UPDATE moments SET {sets} WHERE id=?", (*fields.values(), pid))
            conn.commit()
        row = conn.execute("SELECT * FROM moments WHERE id=?", (pid,)).fetchone()
        conn.close()
        self._send_json({"ok": True, "item": dict(row)})

    def api_patch_activity(self, path):
        try:
            pid = int(path.rsplit("/", 1)[1])
        except (ValueError, IndexError):
            return self._send_error("参数错误")
        data = self._read_json() or {}
        conn = get_db()
        row = conn.execute("SELECT * FROM activities WHERE id=?", (pid,)).fetchone()
        if not row:
            conn.close()
            return self._send_error("不存在", 404)
        fields = {}
        for k in ("name", "category", "note"):
            if k in data and isinstance(data[k], str):
                fields[k] = data[k]
        if fields:
            sets = ", ".join(f"{k}=?" for k in fields)
            conn.execute(f"UPDATE activities SET {sets} WHERE id=?", (*fields.values(), pid))
            conn.commit()
        row = conn.execute("SELECT * FROM activities WHERE id=?", (pid,)).fetchone()
        conn.close()
        self._send_json({"ok": True, "item": dict(row)})

    def api_patch_anniversary(self, path):
        try:
            aid = int(path.rsplit("/", 1)[1])
        except (ValueError, IndexError):
            return self._send_error("参数错误")
        data = self._read_json() or {}
        conn = get_db()
        fields = {}
        if "name" in data:
            fields["name"] = data["name"]
        if "date" in data:
            fields["date"] = data["date"]
        if "is_yearly" in data:
            fields["is_yearly"] = 1 if data["is_yearly"] else 0
        if fields:
            sets = ", ".join(f"{k}=?" for k in fields)
            conn.execute(f"UPDATE anniversaries SET {sets} WHERE id=?", (*fields.values(), aid))
            conn.commit()
        row = conn.execute("SELECT * FROM anniversaries WHERE id=?", (aid,)).fetchone()
        conn.close()
        self._send_json({"ok": True, "item": dict(row)})

    # ============ DELETE ============
    def handle_api_delete(self, path):
        table = None
        if path.startswith("/api/moments/"):
            table = "moments"
        elif path.startswith("/api/places/"):
            table = "places"
        elif path.startswith("/api/activities/"):
            table = "activities"
        elif path.startswith("/api/anniversaries/"):
            table = "anniversaries"
        if not table:
            return self._send_error("Not Found", 404)
        try:
            pid = int(path.rsplit("/", 1)[1])
        except (ValueError, IndexError):
            return self._send_error("参数错误")
        conn = get_db()
        conn.execute(f"DELETE FROM {table} WHERE id=?", (pid,))
        conn.commit()
        conn.close()
        self._send_json({"ok": True})

    def log_message(self, fmt, *args):
        # 精简日志
        print(f"[{now_str()}] {self.command} {self.path}")


def main():
    init_db()
    print("=" * 50)
    print("  二人生活记录 · OurDays 已启动")
    print(f"  访问地址：http://localhost:{PORT}")
    print(f"  数据文件：{DB_PATH}")
    print("  按 Ctrl+C 停止")
    print("=" * 50)
    server = ThreadingHTTPServer(("0.0.0.0", PORT), Handler)
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        print("\n已停止")


if __name__ == "__main__":
    main()
