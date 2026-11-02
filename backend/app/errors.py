"""Consistent error responses.

Every error leaves the API in one shape:

    { "error": { "code": "NOT_FOUND", "message": "...", "details": {...} } }
"""

from __future__ import annotations

import logging
from collections.abc import Mapping, Sequence
from http import HTTPStatus
from typing import Any

from fastapi import FastAPI, Request, status
from fastapi.encoders import jsonable_encoder
from fastapi.exceptions import RequestValidationError
from fastapi.responses import JSONResponse
from pydantic import BaseModel, Field
from starlette.exceptions import HTTPException as StarletteHTTPException

logger = logging.getLogger(__name__)

STATUS_CODES: dict[int, str] = {
    400: "BAD_REQUEST",
    401: "UNAUTHORIZED",
    403: "FORBIDDEN",
    404: "NOT_FOUND",
    405: "METHOD_NOT_ALLOWED",
    409: "CONFLICT",
    410: "GONE",
    413: "PAYLOAD_TOO_LARGE",
    415: "UNSUPPORTED_MEDIA_TYPE",
    422: "VALIDATION_FAILED",
    429: "TOO_MANY_REQUESTS",
    500: "INTERNAL_ERROR",
    503: "SERVICE_UNAVAILABLE",
}


class ErrorBody(BaseModel):
    code: str
    message: str
    details: dict[str, Any] = Field(default_factory=dict)


class ErrorResponse(BaseModel):
    """Documented in OpenAPI so clients can rely on the shape."""

    error: ErrorBody


class AppError(Exception):
    """Raise from services and routers for any expected failure."""

    def __init__(
        self,
        *,
        status_code: int,
        message: str,
        code: str | None = None,
        details: Mapping[str, Any] | None = None,
        headers: Mapping[str, str] | None = None,
    ) -> None:
        super().__init__(message)
        self.status_code = status_code
        self.code = code or code_for_status(status_code)
        self.message = message
        self.details = dict(details or {})
        self.headers = dict(headers or {})


def code_for_status(status_code: int) -> str:
    if status_code in STATUS_CODES:
        return STATUS_CODES[status_code]
    try:
        return HTTPStatus(status_code).name
    except ValueError:
        return "ERROR"


def error_response(
    status_code: int,
    code: str,
    message: str,
    details: Mapping[str, Any] | None = None,
    headers: Mapping[str, str] | None = None,
) -> JSONResponse:
    body = ErrorResponse(error=ErrorBody(code=code, message=message, details=dict(details or {})))
    return JSONResponse(
        status_code=status_code,
        content=jsonable_encoder(body),
        headers=dict(headers) if headers else None,
    )


def _validation_issues(errors: Sequence[Any]) -> list[dict[str, Any]]:
    """Keep only JSON-safe fields; pydantic's `ctx` can hold exception objects."""
    issues: list[dict[str, Any]] = []
    for err in errors:
        loc = [str(part) for part in err.get("loc", ())]
        issues.append(
            {
                "field": ".".join(loc[1:]) if len(loc) > 1 else ".".join(loc),
                "location": loc[0] if loc else "",
                "message": str(err.get("msg", "Invalid value")),
                "type": str(err.get("type", "value_error")),
            }
        )
    return issues


async def _handle_app_error(_: Request, exc: Exception) -> JSONResponse:
    assert isinstance(exc, AppError)  # noqa: S101 - registered only for AppError
    return error_response(exc.status_code, exc.code, exc.message, exc.details, exc.headers)


async def _handle_http_exception(_: Request, exc: Exception) -> JSONResponse:
    assert isinstance(exc, StarletteHTTPException)  # noqa: S101 - registered only for this type
    # FastAPI's HTTPException allows any JSON-able detail; Starlette's is typed as str.
    detail: object = exc.detail
    message = detail if isinstance(detail, str) and detail else HTTPStatus(exc.status_code).phrase
    details: dict[str, Any] = (
        {str(key): value for key, value in detail.items()} if isinstance(detail, dict) else {}
    )
    return error_response(
        exc.status_code,
        code_for_status(exc.status_code),
        message,
        details,
        getattr(exc, "headers", None),
    )


async def _handle_validation_error(_: Request, exc: Exception) -> JSONResponse:
    assert isinstance(exc, RequestValidationError)  # noqa: S101 - registered only for this type
    issues = _validation_issues(exc.errors())
    count = len(issues)
    message = (
        "The request has 1 invalid field."
        if count == 1
        else (f"The request has {count} invalid fields.")
    )
    return error_response(
        status.HTTP_422_UNPROCESSABLE_CONTENT, "VALIDATION_FAILED", message, {"issues": issues}
    )


async def _handle_unexpected(request: Request, exc: Exception) -> JSONResponse:
    logger.exception("Unhandled error on %s %s", request.method, request.url.path, exc_info=exc)
    return error_response(
        status.HTTP_500_INTERNAL_SERVER_ERROR,
        "INTERNAL_ERROR",
        "Something went wrong on our side. Please try again.",
    )


def register_error_handlers(app: FastAPI) -> None:
    app.add_exception_handler(AppError, _handle_app_error)
    app.add_exception_handler(StarletteHTTPException, _handle_http_exception)
    app.add_exception_handler(RequestValidationError, _handle_validation_error)
    app.add_exception_handler(Exception, _handle_unexpected)
