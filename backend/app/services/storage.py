"""Local-disk file storage under FILE_STORAGE_PATH.

Only this module touches the disk, so moving to object storage later replaces one class
(docs/01-requirements.md, open question 3).
"""

import os
import shutil
import tempfile
from pathlib import Path, PurePosixPath
from typing import BinaryIO

CHUNK_BYTES = 1024 * 1024


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

    def save_stream(self, relative: str, source: BinaryIO, *, max_bytes: int) -> int | None:
        """Copy `source` to `relative` in chunks, atomically. Returns the bytes written, or None
        (and writes nothing) when it's larger than `max_bytes`."""
        target = self._resolve(relative)
        target.parent.mkdir(parents=True, exist_ok=True)
        fd, temp = tempfile.mkstemp(dir=target.parent, prefix=".tmp-")
        written = 0
        try:
            with os.fdopen(fd, "wb") as handle:
                while chunk := source.read(CHUNK_BYTES):
                    written += len(chunk)
                    if written > max_bytes:
                        Path(temp).unlink(missing_ok=True)
                        return None
                    handle.write(chunk)
            Path(temp).replace(target)
        except BaseException:
            Path(temp).unlink(missing_ok=True)
            raise
        return written

    def copy(self, source: str, target: str) -> None:
        destination = self._resolve(target)
        destination.parent.mkdir(parents=True, exist_ok=True)
        fd, temp = tempfile.mkstemp(dir=destination.parent, prefix=".tmp-")
        os.close(fd)
        try:
            shutil.copyfile(self._resolve(source), temp)
            Path(temp).replace(destination)
        except BaseException:
            Path(temp).unlink(missing_ok=True)
            raise

    def path(self, relative: str) -> Path:
        return self._resolve(relative)

    def exists(self, relative: str) -> bool:
        return self._resolve(relative).is_file()

    def delete(self, relative: str) -> None:
        self._resolve(relative).unlink(missing_ok=True)
