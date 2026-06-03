"""Simulator driver — generates realistic production data with no hardware.

Lets the entire MES (collector, database, analytics, dashboard) run and be
demoed off-site. Each line cycles through recipes and operators, increments a
product counter at roughly its ideal rate, and occasionally stops, faults, or
resets its counter — exercising every branch of the collector state machine.

Enable globally with ``MES_SIMULATE=1`` or ``site.simulate: true`` in the
config, or per-line with ``driver: simulator``.
"""

from __future__ import annotations

import random
import time as _time
from typing import Any

from .base import LineReading, PLCDriver

# Per-line flavour so the dashboard looks like a real bakery.
_RECIPES = {
    "bread_line": ["White Tin 680g", "Wholemeal 750g", "Sourdough Batch", "Multigrain 700g"],
    "wp_dough_line": ["Pizza Base 12in", "Focaccia Sheet", "Ciabatta Dough", "Flatbread"],
    "cheersonic_line": ["Cheese Slice 200g", "Cheese Block 1kg", "Halloumi Pack"],
}
_DEFAULT_RECIPES = ["Recipe A", "Recipe B", "Recipe C"]

_OPERATORS = [
    "Sarah Chen", "Mark Taylor", "Priya Nair", "Tom Walsh",
    "Aisha Khan", "Dave Roberts", "Mia Lombardi", "Jack Nguyen",
]


class SimulatorDriver(PLCDriver):
    def __init__(self, key: str, name: str, tags: dict[str, str],
                 ideal_rate_per_hour: float = 600.0, **kw: Any):
        super().__init__(key, name, tags, **kw)
        self.ideal_rate = ideal_rate_per_hour or 600.0
        self._recipes = _RECIPES.get(key, _DEFAULT_RECIPES)
        rng = random.Random(hash(key) & 0xFFFFFFFF)
        self._rng = rng
        self._count = 0
        self._reject = 0
        self._operator = rng.choice(_OPERATORS)
        self._recipe = rng.choice(self._recipes)
        self._running = True
        self._fault = False
        self._last_t = _time.monotonic()
        # Time (monotonic seconds) until the next operator/recipe change & next stop.
        self._next_recipe_change = self._last_t + rng.uniform(120, 300)
        self._next_operator_change = self._last_t + rng.uniform(300, 600)
        self._next_state_change = self._last_t + rng.uniform(40, 120)

    def connect(self) -> None:  # nothing to open
        pass

    def close(self) -> None:  # nothing to close
        pass

    def read(self) -> LineReading:
        now = _time.monotonic()
        dt = now - self._last_t
        self._last_t = now

        # Occasionally fault / stop / resume.
        if now >= self._next_state_change:
            roll = self._rng.random()
            if self._running and roll < 0.5:
                self._running = False
                self._fault = roll < 0.15  # some stops are faults
                self._next_state_change = now + self._rng.uniform(15, 60)
            else:
                self._running = True
                self._fault = False
                self._next_state_change = now + self._rng.uniform(60, 180)

        # Recipe changeover (resets the PLC counter -> exercises reset handling).
        if now >= self._next_recipe_change:
            self._recipe = self._rng.choice(self._recipes)
            self._count = 0
            self._reject = 0
            self._running = False
            self._next_recipe_change = now + self._rng.uniform(180, 420)
            self._next_state_change = now + self._rng.uniform(10, 30)

        # Operator handover.
        if now >= self._next_operator_change:
            self._operator = self._rng.choice(_OPERATORS)
            self._next_operator_change = now + self._rng.uniform(300, 700)

        # Advance the product counter while running.
        if self._running:
            per_sec = self.ideal_rate / 3600.0
            produced = per_sec * dt * self._rng.uniform(0.85, 1.05)
            whole = int(produced) + (1 if self._rng.random() < (produced % 1) else 0)
            self._count += whole
            if whole and self._rng.random() < 0.03:
                self._reject += 1

        live_rate = self.ideal_rate * (self._rng.uniform(0.85, 1.05) if self._running else 0.0)

        return LineReading(
            operator=self._operator,
            recipe=self._recipe,
            count=self._count,
            running=self._running,
            fault=self._fault,
            reject=self._reject,
            rate=round(live_rate, 1),
            online=True,
            raw={"sim": True},
        )
