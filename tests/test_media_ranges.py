import io
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

import dev_server


class CaptureHandler(dev_server.Handler):
    def __init__(self, range_header=None):
        self.headers = {"Range": range_header} if range_header else {}
        self.wfile = io.BytesIO()
        self.status = None
        self.response_headers = {}

    def send_response(self, status):
        self.status = status

    def send_header(self, name, value):
        self.response_headers[name] = value

    def end_headers(self):
        pass

    def send_error(self, status):
        self.status = status


class MediaRangeTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.uploads = Path(self.temp.name)
        self.filename = "a" * 32 + ".mp4"
        (self.uploads / self.filename).write_bytes(b"0123456789")
        patcher = patch.object(dev_server, "UPLOADS", self.uploads)
        patcher.start()
        self.addCleanup(patcher.stop)

    def test_suffix_range_returns_end_of_file(self):
        handler = CaptureHandler("bytes=-4")
        handler.serve_media(self.filename)
        self.assertEqual(handler.status, 206)
        self.assertEqual(handler.response_headers["Content-Range"], "bytes 6-9/10")
        self.assertEqual(handler.wfile.getvalue(), b"6789")

    def test_head_has_range_headers_without_body(self):
        handler = CaptureHandler("bytes=2-5")
        handler.serve_media(self.filename, head_only=True)
        self.assertEqual(handler.status, 206)
        self.assertEqual(handler.response_headers["Content-Length"], "4")
        self.assertEqual(handler.response_headers["Accept-Ranges"], "bytes")
        self.assertEqual(handler.wfile.getvalue(), b"")

    def test_rejects_invalid_range(self):
        handler = CaptureHandler("bytes=20-")
        handler.serve_media(self.filename)
        self.assertEqual(handler.status, 416)


if __name__ == "__main__":
    unittest.main()
