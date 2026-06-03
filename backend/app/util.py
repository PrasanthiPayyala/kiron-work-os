import uuid
from collections.abc import Mapping


def row(m: Mapping) -> dict:
    """Convert a SQLAlchemy RowMapping to a plain dict, stringifying UUIDs.

    psycopg returns uuid.UUID objects; the rest of the app (JWT subjects, the
    frontend, set-membership authz checks) works in strings, so normalize here.
    """
    out: dict = {}
    for k, v in m.items():
        out[k] = str(v) if isinstance(v, uuid.UUID) else v
    return out
