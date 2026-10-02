#!/usr/bin/env python3
"""
Smart Plant - GitHub Webhook Listener for Raspberry Pi
Nhận sự kiện Webhook từ GitHub (qua Smee.io relay) và tự động chạy auto_update.sh.
Không cần mở port router, không cần IP tĩnh, hoàn toàn bảo mật.
"""

import sys
import os
import json
import time
import subprocess
import threading
import urllib.request
import urllib.error
from datetime import datetime

DEFAULT_SMEE_URL = "https://smee.io/vJo3oGd8YjGekcKS"
SCRIPT_DIR = os.path.dirname(os.path.abspath(__file__))
AUTO_UPDATE_SCRIPT = os.path.join(SCRIPT_DIR, "auto_update.sh")

# Khóa tránh chạy nhiều lần cập nhật đồng thời
update_lock = threading.Lock()
is_updating = False

def log(msg):
    now = datetime.now().strftime("%Y-%m-%d %H:%M:%S")
    print(f"[{now}] {msg}", flush=True)

def run_update():
    global is_updating
    with update_lock:
        if is_updating:
            log("⏳ Đang có quá trình cập nhật chạy trước đó, bỏ qua...")
            return
        is_updating = True

    try:
        log("🚀 Bắt đầu quá trình cập nhật hệ thống...")
        if not os.path.exists(AUTO_UPDATE_SCRIPT):
            log(f"❌ Không tìm thấy script: {AUTO_UPDATE_SCRIPT}")
            return

        process = subprocess.Popen(
            ["bash", AUTO_UPDATE_SCRIPT],
            stdout=subprocess.PIPE,
            stderr=subprocess.STDOUT,
            text=True,
            cwd=SCRIPT_DIR
        )

        for line in process.stdout:
            print(f"   | {line.rstrip()}", flush=True)

        process.wait()
        if process.returncode == 0:
            log("🎉 Cập nhật thành công!")
        else:
            log(f"⚠️ Cập nhật kết thúc với mã lỗi: {process.returncode}")
    except Exception as e:
        log(f"❌ Lỗi khi thực thi auto_update.sh: {e}")
    finally:
        with update_lock:
            is_updating = False

def handle_payload(payload):
    try:
        # Smee payload có thể chứa header và body
        headers = payload.get("headers", {})
        event = payload.get("x-github-event") or headers.get("x-github-event", "")
        body = payload.get("body", {})

        if isinstance(body, str):
            try:
                body = json.loads(body)
            except Exception:
                pass

        if event == "ping":
            zen = body.get("zen", "")
            hook_id = body.get("hook_id", "")
            log(f"🏓 Nhận GitHub Webhook Ping! (Hook ID: {hook_id}, Zen: \"{zen}\")")
            log("✅ Webhook đã kết nối thành công tới GitHub!")
            return

        if event == "push" or not event:
            ref = body.get("ref", "")
            commits = body.get("commits", [])
            sender = body.get("sender", {}).get("login", "unknown")
            head_commit = body.get("head_commit", {})
            commit_msg = head_commit.get("message", "No message") if head_commit else "Direct trigger"

            if ref and ref != "refs/heads/main":
                log(f"ℹ️ Bỏ qua push event trên nhánh {ref} (chỉ theo dõi refs/heads/main)")
                return

            log(f"🔔 Nhận sự kiện Git Push từ '{sender}' trên nhánh main!")
            log(f"   Commit: {commit_msg.strip().splitlines()[0]}")
            if commits:
                log(f"   Số commits: {len(commits)}")

            # Chạy update trong background thread để không chặn stream SSE
            t = threading.Thread(target=run_update, daemon=True)
            t.start()
    except Exception as e:
        log(f"⚠️ Lỗi khi xử lý payload: {e}")

def listen_smee(smee_url):
    log(f"🌱 Smart Plant Webhook Service đang khởi động...")
    log(f"🌐 Smee Webhook URL : {smee_url}")
    log(f"📁 Thư mục dự án    : {SCRIPT_DIR}")
    log(f"🔧 Script cập nhật  : {AUTO_UPDATE_SCRIPT}")

    retry_delay = 3
    while True:
        try:
            req = urllib.request.Request(
                smee_url,
                headers={
                    "Accept": "text/event-stream",
                    "User-Agent": "SmartPlant-Pi4-Webhook/1.0",
                    "Cache-Control": "no-cache"
                }
            )

            log("🔌 Đang kết nối tới Smee Relay...")
            with urllib.request.urlopen(req, timeout=90) as resp:
                log("✅ Đã kết nối tới Smee Relay! Đang lắng nghe sự kiện push từ GitHub...")
                retry_delay = 3

                buffer = ""
                for raw_line in resp:
                    line = raw_line.decode("utf-8")
                    if line.startswith("data:"):
                        buffer += line[5:].strip()
                    elif line == "\n" or line == "\r\n":
                        if buffer:
                            try:
                                payload = json.loads(buffer)
                                handle_payload(payload)
                            except json.JSONDecodeError:
                                pass
                            buffer = ""

        except (urllib.error.URLError, TimeoutError, ConnectionResetError) as e:
            log(f"⚠️ Mất kết nối tới Smee ({e}). Thử lại sau {retry_delay} giây...")
            time.sleep(retry_delay)
            retry_delay = min(retry_delay * 2, 60)
        except Exception as e:
            log(f"❌ Lỗi bất ngờ: {e}. Thử lại sau {retry_delay} giây...")
            time.sleep(retry_delay)
            retry_delay = min(retry_delay * 2, 60)

if __name__ == "__main__":
    if "--test" in sys.argv:
        log("🧪 Chạy thử nghiệm cập nhật...")
        run_update()
        sys.exit(0)

    url = os.environ.get("SMEE_URL") or (sys.argv[1] if len(sys.argv) > 1 else DEFAULT_SMEE_URL)
    listen_smee(url)
