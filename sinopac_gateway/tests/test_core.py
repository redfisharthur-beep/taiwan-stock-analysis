import unittest
from datetime import datetime, timezone
from types import SimpleNamespace
from core import clean_snapshot, snapshot_time, valid_stock


class GatewayCoreTests(unittest.TestCase):
    def test_stock_code_is_strict(self):
        self.assertTrue(valid_stock("2330"))
        for code in ("", "2330&x=1", "2330/../", "TSLA", "123456"):
            self.assertFalse(valid_stock(code))

    def test_sanitizes_snapshot_and_keeps_observed_time(self):
        snap = SimpleNamespace(code="2330", exchange="TSE", close=101.5,
                               datetime=datetime(2026, 9, 24, 13, 31),
                               person_id="PRIVATE", account_id="PRIVATE", secret_key="PRIVATE")
        data = clean_snapshot(snap, "2330")
        self.assertEqual(data["price"], 101.5)
        self.assertEqual(data["observedAt"], "2026-09-24T13:31:00+08:00")
        self.assertEqual(set(data), {"stock", "exchange", "price", "observedAt", "source", "kind"})
        self.assertNotIn("PRIVATE", repr(data))

    def test_invalid_symbol_exchange_or_quote_cannot_be_presented(self):
        snap = SimpleNamespace(code="2330", exchange="TSE", close=0, datetime="2026-09-24T13:31:00")
        self.assertIsNone(clean_snapshot(snap, "2330"))
        snap.close = 100
        self.assertIsNone(clean_snapshot(snap, "2317"))
        snap.exchange = "TAIFEX"
        self.assertIsNone(clean_snapshot(snap, "2330"))

    def test_nanoseconds_are_parsed_as_utc_and_convert_to_taipei(self):
        self.assertEqual(snapshot_time(None, 1727160000000000000)[:4], "2024")


if __name__ == "__main__":
    unittest.main()
