#!/usr/bin/env python3
"""Run the PLC data collector as a standalone service.

Usage:
    python scripts/run_collector.py

Honours the same environment variables as the rest of the system
(MES_SIMULATE, MES_DB_BACKEND, MES_CONFIG, ...). On the on-site PC this is
typically installed as a Windows service / systemd unit.
"""

import logging
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from mes.collector import Collector  # noqa: E402


def main() -> None:
    logging.basicConfig(
        level=logging.INFO,
        format="%(asctime)s %(levelname)-7s %(name)s | %(message)s",
    )
    collector = Collector()
    try:
        collector.run_forever()
    except KeyboardInterrupt:
        print("\nStopping collector...")
        collector.stop()


if __name__ == "__main__":
    main()
