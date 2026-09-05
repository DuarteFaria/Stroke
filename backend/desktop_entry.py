"""Packaged analyzer entry point; dynamic loopback port and parent lifetime."""
import json
import socket
import sys
import threading
import time
import uvicorn
from backend.main import app, JOBS


def main():
    sock = socket.socket()
    sock.bind(('127.0.0.1', 0))
    server = uvicorn.Server(uvicorn.Config(app, log_level='warning'))

    def watch_parent():
        sys.stdin.buffer.read()
        for job in list(JOBS.values()):
            job['cancel'] = True
        server.should_exit = True

    def ready():
        while not server.started and not server.should_exit:
            time.sleep(.05)
        if server.started:
            print('STROKE_READY=' + json.dumps({'port': sock.getsockname()[1]}), flush=True)

    threading.Thread(target=watch_parent, daemon=True).start()
    threading.Thread(target=ready, daemon=True).start()
    server.run(sockets=[sock])
    deadline = time.monotonic() + 5
    while any(j['status'] == 'running' for j in JOBS.values()) and time.monotonic() < deadline:
        time.sleep(.05)


if __name__ == '__main__':
    main()
