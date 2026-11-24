import io
import logging
import gzip
import tempfile
from pathlib import Path
import unittest
from unittest.mock import patch
import sys
from types import SimpleNamespace
from loguru import logger
from log_privacy import install


class LogPrivacyTests(unittest.TestCase):
    def setUp(self):
        self.addCleanup(logging.setLogRecordFactory, logging.getLogRecordFactory())

    def test_nonpropagating_http_logger(self):
        output = io.StringIO()
        log = logging.Logger('fixture-http')
        log.addHandler(logging.StreamHandler(output))
        original = logger._core.patcher
        self.addCleanup(lambda: logger.configure(patcher=original))
        with patch.dict(sys.modules, logger=SimpleNamespace(logger=logger)):
            install()
        secret = 'fictional' * 4
        try:
            raise RuntimeError(secret)
        except RuntimeError:
            log.exception('Authorization: Bearer %s',secret)
        self.assertNotIn(secret,output.getvalue())
        self.assertIn('RuntimeError',output.getvalue())

    def test_rotated_files_do_not_contain_credentials(self):
        original = logger._core.patcher
        with tempfile.TemporaryDirectory() as tmp:
            handle = logger.add(Path(tmp)/'app.log', rotation=180, compression='gz', diagnose=True)
            secret = 'synthetic' * 5
            try:
                with patch.dict(sys.modules, logger=SimpleNamespace(logger=logger)):
                    install()
                for _ in range(4):
                    logger.warning('fixture header: Authorization: Bearer {}', secret)
            finally:
                logger.remove(handle)
                logger.configure(patcher=original)
            archives = list(Path(tmp).glob('*.gz'))
            self.assertTrue(archives)
            for file in Path(tmp).iterdir():
                data = gzip.decompress(file.read_bytes()) if file.suffix == '.gz' else file.read_bytes()
                self.assertNotIn(secret.encode(),data)

    def test_real_sink_with_diagnose_and_colors(self):
        sink = io.StringIO()
        original = logger._core.patcher
        handle = logger.add(sink, diagnose=True, colorize=True)
        try:
            with patch.dict(sys.modules, logger=SimpleNamespace(logger=logger)):
                install()
                install()
            marker = "sample" * 6
            credential = "12345678" + ":" + marker
            logger.opt(colors=True).warning("<green>POST</green> https://example.invalid/bot{}/sendMessage", credential)
            logger.warning("nested {}", credential.replace(":", "%253A"))
            try:
                raise ValueError(marker)
            except ValueError:
                logger.exception("Request failed")
            self.assertNotIn(marker, sink.getvalue())
            self.assertIn("ValueError", sink.getvalue())
            self.assertIn("Request failed", sink.getvalue())
        finally:
            logger.remove(handle)
            logger.configure(patcher=original)
