from typing import Annotated

from fastapi import APIRouter, Query, Request, status

from app.auth.deps import CurrentUser
from app.auth.jwt import issue_token
from app.auth.providers import get_auth_provider
from app.config import Settings
from app.db import SessionDep
from app.errors import AppError, ErrorResponse
from app.schemas.auth import DevPeople, DevPersonOut, LoginRequest, LoginResponse, UserOut
from app.services import dev_directory

router = APIRouter(prefix="/auth", tags=["auth"])


@router.post(
    "/login",
    response_model=LoginResponse,
    responses={status.HTTP_422_UNPROCESSABLE_CONTENT: {"model": ErrorResponse}},
    summary="Sign in and receive an access token",
)
async def login(body: LoginRequest, request: Request, session: SessionDep) -> LoginResponse:
    settings: Settings = request.app.state.settings
    user = await get_auth_provider(settings, session).authenticate(body)
    issued = issue_token(user, settings)
    return LoginResponse(
        access_token=issued.token, expires_at=issued.expires_at, user=UserOut.from_user(user)
    )


@router.get(
    "/me",
    response_model=UserOut,
    responses={status.HTTP_401_UNAUTHORIZED: {"model": ErrorResponse}},
    summary="The signed-in user",
)
async def me(user: CurrentUser) -> UserOut:
    return UserOut.from_user(user)


@router.get(
    "/dev-people",
    response_model=DevPeople,
    responses={status.HTTP_404_NOT_FOUND: {"model": ErrorResponse}},
    summary="People you can sign in as (AUTH_MODE=dev only)",
)
async def dev_people(
    request: Request,
    session: SessionDep,
    search: Annotated[str, Query(max_length=100)] = "",
    limit: Annotated[int, Query(ge=1, le=dev_directory.MAX_LIMIT)] = 20,
) -> DevPeople:
    """For the dev sign-in page's picker. Public, like the login it feeds, so it exists only
    in dev mode (which production refuses to start with)."""
    settings: Settings = request.app.state.settings
    if settings.auth_mode != "dev":
        raise AppError(status_code=status.HTTP_404_NOT_FOUND, message="Not Found")
    people, total = await dev_directory.search_people(session, search, limit)
    return DevPeople(
        items=[
            DevPersonOut(
                employee_id=p.employee_id,
                name=p.name,
                role=p.role,
                department=p.department,
                location=p.location,
                surveys=p.surveys,
            )
            for p in people
        ],
        total=total,
    )
