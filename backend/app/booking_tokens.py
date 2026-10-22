"""Secret links that let a customer manage their own booking without logging in."""

import hashlib
import secrets


def new_manage_token() -> tuple[str, str]:
    """A fresh (token, hash) pair.

    The token is 32 random bytes from the operating system's secure random
    generator (about 43 URL-safe characters, 2^256 possibilities), so it can't
    be guessed, unlike a booking id. It's only sent to the customer; the
    database stores the hash.
    """
    token = secrets.token_urlsafe(32)
    return token, hash_manage_token(token)


def hash_manage_token(token: str) -> str:
    # A plain SHA-256 is enough here (unlike passwords, which need bcrypt):
    # the token is already long and random, so there's nothing to brute-force.
    return hashlib.sha256(token.encode()).hexdigest()
