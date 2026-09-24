import unittest
from datetime import datetime, timezone
from types import SimpleNamespace
from history import daily_bars

class HistoryTests(unittest.TestCase):
    def test_only_completed_session_is_aggregated_and_invalid_minutes_removed(self):
        raw=SimpleNamespace(
            ts=[datetime(2026,9,22,9,1),datetime(2026,9,22,13,30),
                datetime(2026,9,23,9,1),datetime(2026,9,23,12,0),
                datetime(2026,9,24,9,1),datetime(2026,9,24,13,31)],
            Open=[100,101,105,104,110,111],
            High=[102,104,105,105,112,113],
            Low=[99,100,104,103,109,110],
            Close=[101,103,104,104,111,112],
            Volume=[5,7,8,9,10,11])
        rows=daily_bars(raw,"2026-09-23")
        self.assertEqual(len(rows),1)
        self.assertEqual(rows[0]["date"],"2026-09-22")
        self.assertEqual(rows[0]["open"],100)
        self.assertEqual(rows[0]["close"],103)
        self.assertEqual(rows[0]["high"],104)
        self.assertEqual(rows[0]["low"],99)
        self.assertNotIn("volume",rows[0])
    def test_missing_or_misaligned_history_does_not_generate_daily_bar(self):
        raw=SimpleNamespace(ts=[datetime(2026,9,22,13,30)],Open=[1],High=[],Low=[1],Close=[1],Volume=[1])
        self.assertEqual(daily_bars(raw,"2026-09-22"),[])

if __name__=="__main__":unittest.main()
