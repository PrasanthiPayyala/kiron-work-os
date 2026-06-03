"""Create the target database if it doesn't exist yet.

Connects to the `postgres` maintenance DB using the same credentials as
DATABASE_URL, then CREATE DATABASE <name>. Run:  python -m app.create_db
"""
from sqlalchemy.engine import make_url

import psycopg

from .config import settings


def run() -> None:
    url = make_url(settings.database_url)
    target = url.database
    admin_conninfo = (
        f"host={url.host or 'localhost'} port={url.port or 5432} "
        f"user={url.username} password={url.password} dbname=postgres"
    )
    with psycopg.connect(admin_conninfo, autocommit=True) as conn:
        exists = conn.execute(
            "SELECT 1 FROM pg_database WHERE datname = %s", (target,)
        ).fetchone()
        if exists:
            print(f"Database '{target}' already exists.")
            return
        conn.execute(f'CREATE DATABASE "{target}"')
        print(f"Created database '{target}'.")


if __name__ == "__main__":
    run()
