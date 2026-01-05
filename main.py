import os
import json
import logging
import random
import time
from io import BytesIO
from typing import List
import hashlib
from contextlib import asynccontextmanager

from fastapi import FastAPI, Form, UploadFile, File, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse, FileResponse
from fastapi.staticfiles import StaticFiles
from telethon import TelegramClient, errors, Button
from telethon.tl import functions
import asyncio
from datetime import datetime

# ----- Logging -----
logging.basicConfig(level=logging.INFO)

# ----- Lifespan -----
@asynccontextmanager
async def lifespan(app: FastAPI):
    # Startup logic
    await load_clients()
    asyncio.create_task(run_scheduler())
    yield
    # Shutdown logic (optional)
    for c in clients.values():
        try: await c.disconnect()
        except Exception: pass

# ----- App -----
app = FastAPI(lifespan=lifespan)

# ----- CORS -----
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)

# ----- Constants -----
ACCOUNTS_FILE = "accounts.json"
POSTED_FILE = "posted.json"
ANALYTICS_FILE = "analytics.json"
MEDIA_FOLDER = "media"
SESSIONS_FOLDER = "sessions"
CAPTIONS_FOLDER = "captions"
CAPTIONS_FILE = os.path.join(CAPTIONS_FOLDER, "captions.txt")
MARK_POSTED_FOLDER = "mark-posted"
SCHEDULES_FILE = "schedules.json"
BOT_SETTINGS_FILE = "bot_settings.json"

# ----- Global storage -----
clients = {}
accounts_cache: List[dict] = []
pending_login = {}

# ----- Helpers -----
def ensure_file_exists(path: str, default):
    if not os.path.exists(path):
        with open(path, "w", encoding="utf-8") as f:
            json.dump(default, f)
        logging.info(f"File {path} dibuat karena tidak ditemukan")

# Ensure directories exist
os.makedirs(MEDIA_FOLDER, exist_ok=True)
os.makedirs(CAPTIONS_FOLDER, exist_ok=True)
os.makedirs(MARK_POSTED_FOLDER, exist_ok=True)
ensure_file_exists(SCHEDULES_FILE, [])
ensure_file_exists(BOT_SETTINGS_FILE, {"bot_token": ""})

def load_json(path: str):
    ensure_file_exists(path, [])
    try:
        with open(path, "r", encoding="utf-8") as f:
            return json.load(f)
    except Exception as e:
        logging.error(f"Gagal load JSON {path}: {e}")
        return []

def save_json(path: str, data):
    try:
        # Write atomically to avoid partial writes / corruption
        tmp_path = f"{path}.tmp"
        with open(tmp_path, "w", encoding="utf-8") as f:
            json.dump(data, f, indent=2, ensure_ascii=False)
        os.replace(tmp_path, path)
    except Exception as e:
        logging.error(f"Gagal save JSON {path}: {e}")

def load_accounts() -> List[dict]:
    global accounts_cache
    accounts_cache = load_json(ACCOUNTS_FILE)
    return accounts_cache

def save_accounts(new_accounts: List[dict]):
    global accounts_cache
    accounts_cache = new_accounts
    save_json(ACCOUNTS_FILE, new_accounts)

def load_posted_pairs() -> List[dict]:
    return load_json(POSTED_FILE)

def save_posted_pairs(posted_pairs: List[dict]):
    try:
        # Normalize and deduplicate entries by (file, caption)
        dedup = []
        seen = set()
        for e in posted_pairs:
            fname = e.get("file")
            cap = (e.get("caption") or "").strip()
            key = (fname, cap)
            if key in seen:
                continue
            seen.add(key)
            dedup.append({"file": fname, "caption": cap})
        save_json(POSTED_FILE, dedup)
    except Exception as e:
        logging.error(f"Gagal save_posted_pairs: {e}")

def load_captions() -> List[str]:
    if not os.path.exists(CAPTIONS_FILE):
        return []
    with open(CAPTIONS_FILE, "r", encoding="utf-8") as f:
        return [line.strip() for line in f.readlines() if line.strip()]

def load_analytics() -> dict:
    """Load analytics data from JSON file"""
    ensure_file_exists(ANALYTICS_FILE, {})
    try:
        with open(ANALYTICS_FILE, "r", encoding="utf-8") as f:
            data = json.load(f)
            if isinstance(data, dict):
                return data
            return {}
    except Exception as e:
        logging.error(f"Gagal load analytics {ANALYTICS_FILE}: {e}")
        return {}

def save_analytics(data: dict):
    """Save analytics data to JSON file"""
    save_json(ANALYTICS_FILE, data)

def log_send_result(account_id: str, group: str, success: bool, error_message: str = ""):
    """Log the result of a send operation"""
    try:
        analytics = load_analytics()
        
        # Initialize structure if needed
        if "sends" not in analytics:
            analytics["sends"] = []
        
        # Add new log entry
        log_entry = {
            "account_id": account_id,
            "group": group,
            "success": success,
            "error_message": error_message,
            "timestamp": time.time()
        }
        analytics["sends"].append(log_entry)
        
        # Keep only last 10000 entries to prevent file from growing too large
        if len(analytics["sends"]) > 10000:
            analytics["sends"] = analytics["sends"][-10000:]
        
        save_analytics(analytics)
    except Exception as e:
        logging.error(f"Gagal log send result: {e}")

def get_analytics_summary(group_a: str = None, group_b: str = None) -> dict:
    """Get analytics summary for accounts"""
    try:
        analytics = load_analytics()
        sends = analytics.get("sends", [])
        
        # Filter by groups if provided
        if group_a or group_b:
            filtered_sends = []
            for send in sends:
                send_group = send.get("group", "")
                if group_a and send_group == group_a:
                    filtered_sends.append(send)
                elif group_b and send_group == group_b:
                    filtered_sends.append(send)
            sends = filtered_sends
        
        # Get all unique account IDs
        account_ids = set()
        for send in sends:
            account_ids.add(send.get("account_id"))
        
        # Build summary per account
        account_summary = {}
        for account_id in account_ids:
            account_sends = [s for s in sends if s.get("account_id") == account_id]
            
            # Group by group name
            group_results = {}
            for send in account_sends:
                group = send.get("group", "unknown")
                if group not in group_results:
                    group_results[group] = {"success": 0, "failed": 0, "last_success": None, "last_failed": None}
                
                if send.get("success"):
                    group_results[group]["success"] += 1
                    if not group_results[group]["last_success"] or send.get("timestamp", 0) > group_results[group]["last_success"]:
                        group_results[group]["last_success"] = send.get("timestamp")
                else:
                    group_results[group]["failed"] += 1
                    if not group_results[group]["last_failed"] or send.get("timestamp", 0) > group_results[group]["last_failed"]:
                        group_results[group]["last_failed"] = send.get("timestamp")
            
            account_summary[account_id] = {
                "groups": group_results,
                "total_sends": len(account_sends)
            }
        
        return {
            "accounts": account_summary,
            "total_logs": len(sends)
        }
    except Exception as e:
        logging.error(f"Gagal get analytics summary: {e}")
        return {"accounts": {}, "total_logs": 0}


def _sha256_of_bytes(data: bytes) -> str:
    h = hashlib.sha256()
    h.update(data)
    return h.hexdigest()


def _find_file_by_hash(filename: str, data_hash: str) -> str:
    """If a file with same base name or variant exists and has same hash, return its name; else return empty string."""
    base, ext = os.path.splitext(filename)
    # Check exact name first
    cand = os.path.join(MEDIA_FOLDER, filename)
    try:
        if os.path.exists(cand):
            with open(cand, "rb") as f:
                if _sha256_of_bytes(f.read()) == data_hash:
                    return filename
    except Exception:
        pass
    # Check variants like base_1.ext, base_2.ext
    i = 1
    while True:
        cand_name = f"{base}_{i}{ext}"
        cand = os.path.join(MEDIA_FOLDER, cand_name)
        if not os.path.exists(cand):
            break
        try:
            with open(cand, "rb") as f:
                if _sha256_of_bytes(f.read()) == data_hash:
                    return cand_name
        except Exception:
            pass
        i += 1
    return ""


def mark_posted_entry(filename: str, caption: str = "") -> bool:
    """Helper to record a posted (file,caption) pair and move the file from
    MEDIA_FOLDER to MARK_POSTED_FOLDER if it exists.

    Prevents duplicates by checking both posted.json and mark-posted folder.
    Returns True if the file was moved or the entry was recorded, False on error.
    """
    try:
        caption = (caption or "").strip()
        posted_pairs = load_posted_pairs()
        
        # Check if entry already exists in posted.json (prevent duplicate entries)
        exists_in_json = any(
            (p.get("file") == filename) and ((p.get("caption") or "").strip() == caption)
            for p in posted_pairs
        )
        
        # Check if file already exists in mark-posted folder (prevent duplicate files)
        os.makedirs(MARK_POSTED_FOLDER, exist_ok=True)
        dst_path = os.path.join(MARK_POSTED_FOLDER, filename)
        exists_in_folder = os.path.exists(dst_path)
        
        # If already exists in both places, skip (prevent duplicate)
        if exists_in_json and exists_in_folder:
            logging.info(f"Entry dan file sudah ada di mark-posted: {filename} | '{caption}' - melewati")
            return True
        
        # If exists in JSON but not in folder, add to JSON only (file might have been manually moved)
        if exists_in_json and not exists_in_folder:
            logging.info(f"Entry sudah ada di posted.json tapi file belum dipindah: {filename} | '{caption}'")
            # Try to move file if it exists in media folder
            src = os.path.join(MEDIA_FOLDER, filename)
            if os.path.exists(src):
                try:
                    os.replace(src, dst_path)
                    logging.info(f"File {filename} berhasil dipindahkan ke mark-posted")
                except Exception as e:
                    logging.error(f"Gagal memindahkan file {filename} ke mark-posted: {e}")
            return True
        
        # If not in JSON, add it
        if not exists_in_json:
            posted_pairs.append({"file": filename, "caption": caption})
            save_posted_pairs(posted_pairs)
            logging.info(f"Entry baru ditambahkan ke posted.json: {filename} | '{caption}'")

        # Move file from media to mark-posted folder if exists and not already moved
        try:
            src = os.path.join(MEDIA_FOLDER, filename)
            if os.path.exists(src) and not exists_in_folder:
                # If destination exists (shouldn't happen, but just in case), rename with timestamp
                if os.path.exists(dst_path):
                    base, ext = os.path.splitext(filename)
                    dst_path = os.path.join(MARK_POSTED_FOLDER, f"{base}_{int(time.time())}{ext}")
                    logging.warning(f"File {filename} sudah ada di mark-posted, menggunakan nama baru: {os.path.basename(dst_path)}")
                os.replace(src, dst_path)
                logging.info(f"File {filename} berhasil dipindahkan ke mark-posted")
            elif not os.path.exists(src) and exists_in_folder:
                # File already in mark-posted, that's fine
                logging.info(f"File {filename} sudah ada di mark-posted folder")
            elif not os.path.exists(src) and not exists_in_folder:
                # File doesn't exist in either place - might have been deleted
                logging.warning(f"File {filename} tidak ditemukan di media atau mark-posted folder")
        except Exception as e:
            logging.error(f"Gagal memindahkan file ke mark-posted: {e}")
            return False
            
        return True
    except Exception as e:
        logging.error(f"Gagal menandai posted: {e}")
        return False

# ----- Telegram Client -----
async def start_client(account):
    os.makedirs(SESSIONS_FOLDER, exist_ok=True)
    session_path = os.path.join(SESSIONS_FOLDER, f"{account['id']}.session")
    client = TelegramClient(session_path, account['api_id'], account['api_hash'])
    await client.connect()
    if not await client.is_user_authorized():
        await client.disconnect()
        return None
    logging.info(f"Client {account['id']} loaded")
    return client

async def load_clients():
    global clients
    accounts = load_accounts()
    for c in clients.values():
        try: await c.disconnect()
        except Exception: pass
    clients = {}
    for acc in accounts:
        session_path = os.path.join(SESSIONS_FOLDER, f"{acc['id']}.session")
        if os.path.exists(session_path):
            try:
                client = await start_client(acc)
                if client: clients[acc['id']] = client
            except Exception as e:
                logging.error(f"Gagal load client {acc['id']}: {e}")

# ----- Accounts API -----
@app.get("/accounts/")
async def get_accounts():
    accounts = load_accounts()
    result = []
    for acc in accounts:
        client = clients.get(acc['id'])
        username = first_name = last_name = None
        if client:
            try:
                me = await client.get_me()
                username = me.username
                first_name = me.first_name
                last_name = me.last_name
            except Exception: pass
        result.append({
            "id": acc["id"],
            "phone": acc["phone"],
            "username": username,
            "first_name": first_name,
            "last_name": last_name
        })
    return result

# ----- OTP / Add Account -----
@app.post("/add-account-otp/")
async def add_account_otp(data: dict):
    account_id = data.get("id")
    phone = data.get("phone")
    api_id = data.get("api_id")
    api_hash = data.get("api_hash")
    
    # Cek kelengkapan data
    if not all([account_id, phone, api_id, api_hash]):
        raise HTTPException(status_code=400, detail="Field id, phone, api_id, api_hash harus diisi.")
    
    accounts = load_accounts()
    if any(a["id"] == account_id for a in accounts):
        raise HTTPException(status_code=400, detail=f"Akun dengan ID '{account_id}' sudah ada.")

    # Simpan akun sementara sebelum verifikasi OTP
    accounts.append({"id": account_id, "phone": phone, "api_id": api_id, "api_hash": api_hash})
    save_accounts(accounts)

    client = TelegramClient(os.path.join(SESSIONS_FOLDER, f"{account_id}.session"), api_id, api_hash)
    try:
        await client.connect()
        await client.send_code_request(phone)
        pending_login[account_id] = {"client": client, "phone": phone, "api_id": api_id, "api_hash": api_hash}
    except Exception as e:
        await client.disconnect()
        # Mengembalikan error spesifik dari Telegram API
        raise HTTPException(status_code=500, detail=f"Gagal kirim OTP: {str(e)}")
        
    return {"status": "OTP dikirim", "account_id": account_id, "phone": phone}

@app.post("/verify-otp/")
async def verify_otp(account_id: str = Form(...), code: str = Form(...), password: str = Form(None)):
    pending = pending_login.get(account_id)
    if not pending:
        raise HTTPException(status_code=404, detail="Akun tidak menunggu OTP / belum dikirim.")
    
    client = pending["client"]
    try:
        await client.sign_in(code=code, password=password)
        clients[account_id] = client
        del pending_login[account_id]
        return {"status": "OTP berhasil diverifikasi"}
    except Exception as e:
        raise HTTPException(status_code=400, detail=f"Gagal verifikasi OTP: {str(e)}")

# ----- Media API -----
@app.get("/media-list")
async def media_list():
    posted_pairs = load_posted_pairs()
    os.makedirs(MEDIA_FOLDER, exist_ok=True)
    files = [f for f in os.listdir(MEDIA_FOLDER) if f.lower().endswith(('.png', '.jpg', '.jpeg', '.gif', '.bmp', '.webp'))]
    captions = load_captions() or [""]

    import itertools
    available_pairs = list(itertools.product(files, captions))
    random.shuffle(available_pairs)

    result = []
    for fname, cap in available_pairs:
        if {"file": fname, "caption": cap} not in posted_pairs:
            result.append({"file": fname, "caption": cap})
    return result

@app.get("/captions-list")
async def captions_list():
    return load_captions()

@app.post("/mark-posted/")
async def mark_posted_file_json(data: dict):
    filename = data.get("file")
    caption = data.get("caption", "")
    if not filename: raise HTTPException(status_code=400, detail="Field 'file' harus diisi")
    # Use helper to record and move the file. Keep endpoint behavior simple.
    ok = mark_posted_entry(filename, caption)
    return {"status": f"File {filename} dengan caption ditandai posted"}


# Endpoint: upload media files (images)
@app.post("/upload-media/")
async def upload_media(file: UploadFile = File(...)):
    os.makedirs(MEDIA_FOLDER, exist_ok=True)
    filename = file.filename
    dest_path = os.path.join(MEDIA_FOLDER, filename)
    try:
        contents = await file.read()
        # If an identical file already exists in media (by hash), reuse it and don't create a duplicate
        data_hash = _sha256_of_bytes(contents)
        existing = _find_file_by_hash(filename, data_hash)
        if existing:
            return {"status": "ok", "filename": existing}

        # If filename exists but different content, find a unique filename
        if os.path.exists(dest_path):
            base, ext = os.path.splitext(filename)
            counter = 1
            while os.path.exists(os.path.join(MEDIA_FOLDER, f"{base}_{counter}{ext}")):
                counter += 1
            dest_path = os.path.join(MEDIA_FOLDER, f"{base}_{counter}{ext}")
        with open(dest_path, "wb") as f:
            f.write(contents)
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Gagal upload media: {e}")
    return {"status": "ok", "filename": os.path.basename(dest_path)}


# Endpoint: upload captions file (captions.txt)
@app.post("/upload-captions/")
async def upload_captions(file: UploadFile = File(...)):
    os.makedirs(CAPTIONS_FOLDER, exist_ok=True)
    # Only accept a file named captions.txt or any text file
    try:
        contents = await file.read()
        # Write/replace captions file
        with open(CAPTIONS_FILE, "wb") as f:
            f.write(contents)
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Gagal upload captions: {e}")
    return {"status": "ok", "filename": os.path.basename(CAPTIONS_FILE)}


# Endpoint: clear captions after batch
@app.post("/clear-captions/")
async def clear_captions():
    try:
        if os.path.exists(CAPTIONS_FILE):
            # Truncate the captions file
            open(CAPTIONS_FILE, 'w', encoding='utf-8').close()
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Gagal menghapus captions: {e}")
    return {"status": "captions cleared"}


# ----- Join Group -----
@app.post("/join-group/")
async def join_group(account_id: str = Form(...), group: str = Form(...)):
    """Auto-join a group/channel for an account. Handles usernames, IDs, and invite links."""
    client = clients.get(account_id)
    if not client:
        raise HTTPException(status_code=404, detail=f"Akun {account_id} tidak ditemukan")
    
    # Bersihkan input (hapus spasi, tangani format URL)
    target = group.strip()
    
    # Tangani URL lengkap (https://t.me/username atau https://t.me/joinchat/hash)
    if "t.me/" in target:
        target = target.split("t.me/")[-1]
    
    # Hapus @ jika ada
    if target.startswith("@"):
        target = target[1:]

    try:
        # 1. Jika ini link private (joinchat/hash)
        if "joinchat/" in target or "+" in target:
            invite_hash = target.split("joinchat/")[-1] if "joinchat/" in target else target.replace("+", "")
            try:
                await client(functions.messages.ImportChatInviteRequest(hash=invite_hash))
                return {"status": f"Berhasil bergabung via invite link", "already_member": False}
            except errors.UserAlreadyParticipantError:
                return {"status": "Sudah menjadi anggota", "already_member": True}
        
        # 2. Jika ini username atau ID
        try:
            entity = await client.get_entity(target)
            
            # Cek apakah sudah member
            try:
                await client.get_permissions(entity, await client.get_me())
                return {"status": "Sudah menjadi anggota", "already_member": True}
            except errors.UserNotParticipantError:
                pass
            
            # Coba join public channel/group
            await client(functions.channels.JoinChannelRequest(entity))
            return {"status": "Berhasil bergabung ke grup", "already_member": False}
        except Exception:
            # Fallback jika get_entity gagal tapi mungkin dia private link tanpa joinchat/
            await client(functions.messages.ImportChatInviteRequest(hash=target))
            return {"status": "Berhasil bergabung via hash", "already_member": False}
                
    except errors.InviteHashExpiredError:
        raise HTTPException(status_code=400, detail="Link invite sudah kadaluarsa")
    except errors.InviteHashInvalidError:
        raise HTTPException(status_code=400, detail="Link invite tidak valid")
    except errors.FloodWaitError as e:
        raise HTTPException(status_code=429, detail=f"Flood wait {e.seconds} detik")
    except Exception as e:
        logging.error(f"Error joining {target} with {account_id}: {e}")
        raise HTTPException(status_code=500, detail=f"Gagal bergabung: {str(e)}")

# ----- Post to Group -----
@app.post("/post-to-group/")
async def post_to_group(
    account_id: str = Form(...),
    group: str = Form(...),
    message: str = Form(""),
    file: UploadFile = File(None),
    random_post: bool = Form(False),
    mark_posted: bool = Form(False)  # New parameter: only mark as posted if True
):
    """Post to a group. Set mark_posted=True only after successful send to ALL groups."""
    client = clients.get(account_id)
    if not client:
        raise HTTPException(status_code=404, detail=f"Akun {account_id} tidak ditemukan")

    try:
        if random_post:
            media_items = await media_list()
            if not media_items:
                raise HTTPException(status_code=404, detail="Tidak ada media tersedia")
            selected = random.choice(media_items)
            file_path = os.path.join(MEDIA_FOLDER, selected['file'])
            contents = open(file_path, "rb").read()
            bio = BytesIO(contents)
            bio.name = selected['file']
            await client.send_file(group, bio, caption=selected['caption'])
            # Mark and move the posted file only if mark_posted is True
            if mark_posted:
                mark_posted_entry(selected['file'], selected.get('caption', ""))
        else:
            if file:
                # Persist uploaded file to media folder first so we can mark/move it
                os.makedirs(MEDIA_FOLDER, exist_ok=True)
                upload_name = file.filename
                dest_path = os.path.join(MEDIA_FOLDER, upload_name)
                contents = await file.read()

                # If an identical file already exists in media (by hash), reuse it
                data_hash = _sha256_of_bytes(contents)
                existing = _find_file_by_hash(upload_name, data_hash)
                if existing:
                    upload_name = existing
                    dest_path = os.path.join(MEDIA_FOLDER, upload_name)
                else:
                    # If filename exists but different content, find a unique filename
                    if os.path.exists(dest_path):
                        base, ext = os.path.splitext(upload_name)
                        counter = 1
                        while os.path.exists(os.path.join(MEDIA_FOLDER, f"{base}_{counter}{ext}")):
                            counter += 1
                        upload_name = f"{base}_{counter}{ext}"
                        dest_path = os.path.join(MEDIA_FOLDER, upload_name)
                    with open(dest_path, "wb") as f:
                        f.write(contents)

                # Send the saved (or existing) file
                with open(dest_path, "rb") as fobj:
                    bio = BytesIO(fobj.read())
                    bio.name = upload_name
                    await client.send_file(group, bio, caption=message)

                # Mark and move the posted file ONLY if mark_posted is True
                # This should only be set after successful send to ALL groups
                if mark_posted:
                    mark_posted_entry(upload_name, message)
            else:
                if not message.strip():
                    raise HTTPException(status_code=400, detail="Pesan kosong tidak boleh dikirim tanpa gambar")
                await client.send_message(group, message)
    except errors.FloodWaitError as e:
        error_msg = f"Flood wait {e.seconds} detik"
        log_send_result(account_id, group, False, error_msg)
        raise HTTPException(status_code=429, detail=error_msg)
    except errors.UserNotParticipantError:
        # Account is not a member of the target group — return a clear error
        error_msg = "Akun belum bergabung ke grup tujuan / tidak ditemukan di grup"
        log_send_result(account_id, group, False, error_msg)
        raise HTTPException(status_code=400, detail=error_msg)
    except errors.ChatWriteForbiddenError:
        # Bot/akun tidak bisa menulis di grup (misal dibatasi oleh admin)
        error_msg = "Akun tidak diizinkan mengirim pesan ke grup (write forbidden)"
        log_send_result(account_id, group, False, error_msg)
        raise HTTPException(status_code=400, detail=error_msg)
    except errors.ChannelPrivateError:
        error_msg = "Grup/private tidak dapat diakses atau tidak ditemukan"
        log_send_result(account_id, group, False, error_msg)
        raise HTTPException(status_code=400, detail=error_msg)
    except Exception as e:
        # For any other telethon / RPC errors, return a safe error message without crashing
        error_msg = f"Error tidak terduga: {str(e)}"
        logging.error(f"Unexpected error posting to group: {e}")
        log_send_result(account_id, group, False, error_msg)
        raise HTTPException(status_code=500, detail=error_msg)

    # Log successful send
    log_send_result(account_id, group, True, "")
    return {"status": f"Pesan terkirim dari {account_id}"}

# ----- Update Profile -----
@app.post("/update-name/")
async def update_name(account_id: str = Form(...), new_first_name: str = Form(...), new_last_name: str = Form("")):
    if not new_first_name.strip():
        raise HTTPException(status_code=400, detail="First name tidak boleh kosong")
    client = clients.get(account_id)
    if not client: raise HTTPException(status_code=404, detail="Akun tidak ditemukan")
    await client(functions.account.UpdateProfileRequest(first_name=new_first_name.strip(), last_name=new_last_name.strip() or None))
    return {"status": "Nama berhasil diupdate"}

@app.post("/update-username/")
async def update_username(account_id: str = Form(...), username: str = Form(...)):
    client = clients.get(account_id)
    if not client: raise HTTPException(status_code=404, detail="Akun tidak ditemukan")
    me = await client.get_me()
    if username == me.username: return {"status": "Username sama seperti sebelumnya, tidak diubah"}
    try:
        await client(functions.account.UpdateUsernameRequest(username=username))
    except errors.UsernameOccupiedError:
        raise HTTPException(status_code=400, detail="Username sudah digunakan")
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Gagal update username: {str(e)}")
    return {"status": "Username berhasil diupdate"}

@app.post("/update-photo/")
async def update_photo(account_id: str = Form(...), photo: UploadFile = File(...)):
    client = clients.get(account_id)
    if not client: raise HTTPException(status_code=404, detail="Akun tidak ditemukan")
    contents = await photo.read()
    ext = os.path.splitext(photo.filename)[1].lower()
    if ext not in (".jpg", ".jpeg", ".png", ".jfif"): ext = ".jpg"
    bio = BytesIO(contents)
    bio.name = f"profile{ext}"
    try:
        file = await client.upload_file(bio)
        await client(functions.photos.UploadProfilePhotoRequest(file=file))
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Gagal update foto: {str(e)}")
    return {"status": "Foto profil berhasil diupdate"}

# ----- Mount Static -----
app.mount("/media", StaticFiles(directory=MEDIA_FOLDER), name="media")
app.mount("/captions", StaticFiles(directory=CAPTIONS_FOLDER), name="captions")
app.mount("/mark-posted", StaticFiles(directory=MARK_POSTED_FOLDER), name="mark-posted")
app.mount("/static", StaticFiles(directory="static"), name="static")

@app.get("/")
async def root():
    return FileResponse("static/index.html")

@app.get("/ping")
async def ping():
    return {"status": "ok"}

# ----- Analytics API -----
@app.get("/analytics/")
async def get_analytics(group_a: str = None, group_b: str = None):
    """Get analytics summary for accounts"""
    summary = get_analytics_summary(group_a, group_b)
    return summary

@app.post("/analytics/clear/")
async def clear_analytics():
    """Clear all analytics data"""
    try:
        save_analytics({})
        return {"status": "Analytics data cleared"}
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Gagal clear analytics: {str(e)}")

# ----- Run -----
# ----- SCHEDULE LOGIC -----
async def run_scheduler():
    logging.info("Scheduler task started")
    while True:
        try:
            now = datetime.now()
            current_time = now.strftime("%H:%M")
            today_str = now.strftime("%Y-%m-%d")
            
            schedules = load_json(SCHEDULES_FILE)
            changed = False
            
            for s in schedules:
                if s.get("time") == current_time and s.get("last_run") != today_str:
                    # Time to run!
                    logging.info(f"Running schedule: {s.get('id')}")
                    success = await execute_schedule(s)
                    
                    if success:
                        s["last_run"] = today_str
                        if s.get("repeat") == "no":
                            s["active"] = False
                        changed = True
            
            if changed:
                save_json(SCHEDULES_FILE, schedules)
                
        except Exception as e:
            logging.error(f"Error in scheduler: {e}")
            
        await asyncio.sleep(30) # Check every 30s

async def execute_schedule(s):
    bot_token = s.get("bot_token")
    api_id = s.get("api_id")
    api_hash = s.get("api_hash")
    target = s.get("target")
    image_filename = s.get("image_filename")
    caption = s.get("caption", "")
    buttons_raw = s.get("buttons", "")
    
    # Fallback to general API ID/Hash from accounts if not provided in schedule
    if not api_id or not api_hash:
        accounts = load_accounts()
        if accounts:
            api_id = accounts[0].get("api_id")
            api_hash = accounts[0].get("api_hash")
    
    if not bot_token or not api_id or not api_hash:
        logging.error(f"Credentials missing (Bot Token or API ID/Hash) for schedule {s.get('id')}")
        return False

    client = None
    try:
        os.makedirs(SESSIONS_FOLDER, exist_ok=True)
        session_name = f"bot_{hashlib.md5(bot_token.encode()).hexdigest()[:10]}"
        session_path = os.path.join(SESSIONS_FOLDER, session_name)
        
        client = TelegramClient(session_path, int(api_id), api_hash)
        await client.start(bot_token=bot_token)
        
        kb = []
        if buttons_raw:
            for line in buttons_raw.split("\n"):
                if "|" in line:
                    parts = line.split("|")
                    if len(parts) >= 2:
                        kb.append([Button.url(parts[0].strip(), parts[1].strip())])
        
        if image_filename:
            file_path = os.path.join(MEDIA_FOLDER, image_filename)
            if os.path.exists(file_path):
                await client.send_file(target, file_path, caption=caption, buttons=kb if kb else None)
            else:
                await client.send_message(target, caption, buttons=kb if kb else None)
        else:
            await client.send_message(target, caption, buttons=kb if kb else None)
            
        logging.info(f"Schedule {s.get('id')} sent successfully via Bot")
        return True
    except Exception as e:
        logging.error(f"Failed to execute bot schedule {s.get('id')}: {e}")
        return False
    finally:
        if client:
            await client.disconnect()

@app.get("/schedules/")
async def get_schedules():
    return load_json(SCHEDULES_FILE)

@app.post("/schedules/")
async def add_schedule(
    target: str = Form(...),
    time: str = Form(...),
    repeat: str = Form(...),
    caption: str = Form(...),
    bot_token: str = Form(...),
    buttons: str = Form(None),
    image: UploadFile = File(None)
):
    schedules = load_json(SCHEDULES_FILE)
    new_id = hashlib.md5(f"{target}{time}{random.random()}".encode()).hexdigest()[:8]
    
    image_filename = None
    if image:
        image_filename = f"sched_{new_id}_{image.filename}"
        img_path = os.path.join(MEDIA_FOLDER, image_filename)
        with open(img_path, "wb") as f:
            f.write(await image.read())
    
    new_sched = {
        "id": new_id,
        "target": target,
        "time": time,
        "repeat": repeat,
        "caption": caption,
        "image_filename": image_filename,
        "bot_token": bot_token,
        "buttons": buttons,
        "active": True,
        "last_run": ""
    }
    
    schedules.append(new_sched)
    save_json(SCHEDULES_FILE, schedules)
    return {"status": "Jadwal bot berhasil disimpan", "id": new_id}

@app.post("/test-bot-message/")
async def test_bot_message(
    target: str = Form(...),
    caption: str = Form(...),
    bot_token: str = Form(...),
    buttons: str = Form(None),
    image: UploadFile = File(None)
):
    # Temporary ID for log and image
    test_id = f"test_{int(time.time())}"
    image_filename = None
    if image:
        image_filename = f"test_{test_id}_{image.filename}"
        img_path = os.path.join(MEDIA_FOLDER, image_filename)
        with open(img_path, "wb") as f:
            f.write(await image.read())

    mock_schedule = {
        "id": test_id,
        "target": target,
        "caption": caption,
        "bot_token": bot_token,
        "image_filename": image_filename,
        "buttons": buttons
    }
    
    success = await execute_schedule(mock_schedule)
    
    # Cleanup test image if created
    if image_filename and os.path.exists(os.path.join(MEDIA_FOLDER, image_filename)):
        try: os.remove(os.path.join(MEDIA_FOLDER, image_filename))
        except: pass

    if success:
        return {"status": "Test berhasil! Pesan terkirim."}
    else:
        raise HTTPException(status_code=400, detail="Gagal mengirim test. Cek token/target/kredensial API.")

@app.delete("/schedules/{sched_id}")
async def delete_schedule(sched_id: str):
    schedules = load_json(SCHEDULES_FILE)
    filtered = [s for s in schedules if s["id"] != sched_id]
    if len(filtered) == len(schedules):
        raise HTTPException(status_code=404, detail="Jadwal tidak ditemukan")
    save_json(SCHEDULES_FILE, filtered)
    return {"status": "Jadwal berhasil dihapus"}

@app.get("/bot-settings/")
async def get_bot_settings():
    return load_json(BOT_SETTINGS_FILE)

@app.post("/bot-settings/")
async def save_bot_settings(data: dict):
    save_json(BOT_SETTINGS_FILE, data)
    return {"status": "Berhasil disimpan"}

if __name__ == "__main__":
    import uvicorn
    uvicorn.run("main:app", host="127.0.0.1", port=8374, reload=True)
