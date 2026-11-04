"""Local-disk file storage under FILE_STORAGE_PATH.

Only this module touches the disk, so moving to object storage later replaces one class
(docs/01-requirements.md, open question 3).
"""

import os
import tempfile
from pathlib import Path, PurePosixPath


class LocalFileStorage:
    def __init__(self, root: Path) -> None:
        self.root = root.resolve()

    def _resolve(self, relative: str) -> Path:
        path = PurePosixPath(relative)
        if path.is_absolute() or ".." in path.parts or not path.parts:
            msg = f"Unsafe storage path: {relative!r}"
            raise ValueError(msg)
        return self.root.joinpath(*path.parts)

    def save(self, relative: str, data: bytes) -> None:
        """Write atomically: a crash never leaves a half-written file behind."""
        target = self._resolve(relative)
        target.parent.mkdir(parents=True, exist_ok=True)
        fd, temp = tempfile.mkstemp(dir=target.parent, prefix=".tmp-")
        try:
            with os.fdopen(fd, "wb") as handle:
                handle.write(data)
            Path(temp).replace(target)
        except BaseException:
            Path(temp).unlink(missing_ok=True)
            raise

    def path(self, relative: str) -> Path:
        return self._resolve(relative)

    def exists(self, relative: str) -> bool:
        return self._resolve(relative).is_file()

    def delete(self, relative: str) -> None:
        self._resolve(relative).unlink(missing_ok=True)
