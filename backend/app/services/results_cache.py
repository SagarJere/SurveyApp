"""Results are cached for 60 seconds per survey and filter combination (docs/04-api.md).

A submit, publish or close for a survey clears its entries at once, so people see their own
changes straight away. The cache is per process: with several API workers, another worker's
entries expire within the minute.
"""

import time
import uuid
from collections import OrderedDict
from collections.abc import Awaitable, Callable, Hashable
from typing import Any, TypeVar

T = TypeVar("T")

TTL_SECONDS = 60.0
MAX_ENTRIES = 2000


class ResultsCache:
    def __init__(self, ttl: float = TTL_SECONDS, max_entries: int = MAX_ENTRIES) -> None:
        self.ttl = ttl
        self.max_entries = max_entries
        self._entries: OrderedDict[tuple[Any, ...], tuple[float, Any]] = OrderedDict()

    async def get_or_compute(
        self, survey_id: uuid.UUID, key: tuple[Hashable, ...], compute: Callable[[], Awaitable[T]]
    ) -> T:
        full_key = (survey_id, *key)
        now = time.monotonic()
        hit = self._entries.get(full_key)
        if hit is not None and now - hit[0] < self.ttl:
            self._entries.move_to_end(full_key)
            value: T = hit[1]
            return value
        value = await compute()
        self._entries[full_key] = (now, value)
        self._entries.move_to_end(full_key)
        while len(self._entries) > self.max_entries:
            self._entries.popitem(last=False)
        return value

    def invalidate(self, survey_id: uuid.UUID) -> None:
        for key in [k for k in self._entries if k[0] == survey_id]:
            del self._entries[key]

    def clear(self) -> None:
        self._entries.clear()


results_cache = ResultsCache()
