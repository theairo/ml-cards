# Локальний сервер без кешування для розробки: python scripts/dev-server.py
import http.server, socketserver, os

os.chdir(os.path.join(os.path.dirname(os.path.abspath(__file__)), ".."))

class NoCache(http.server.SimpleHTTPRequestHandler):
    def end_headers(self):
        self.send_header("Cache-Control", "no-store")
        super().end_headers()

with socketserver.TCPServer(("127.0.0.1", 8765), NoCache) as s:
    print("http://localhost:8765/?mock=1")
    s.serve_forever()
