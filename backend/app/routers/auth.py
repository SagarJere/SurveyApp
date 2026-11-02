from fastapi import APIRouter, Request, status

from app.auth.deps import CurrentUser
from app.auth.jwt import issue_token
from app.auth.providers import get_auth_provider
from app.config import Settings
from app.db import SessionDep
from app.errors import ErrorResponse
from app.schemas.auth import LoginRequest, LoginResponse, UserOut

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
