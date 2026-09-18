import os
from pathlib import Path

from dotenv import load_dotenv
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker, declarative_base


load_dotenv()

BASE_DIR = Path(__file__).resolve().parent

database_setting = os.getenv(
    "DATABASE_PATH",
    "civic_complaints.db"
).strip() or "civic_complaints.db"

database_path = Path(database_setting)

if not database_path.is_absolute():
    database_path = BASE_DIR / database_path

database_path.parent.mkdir(
    parents=True,
    exist_ok=True
)

DATABASE_PATH = str(database_path)
DATABASE_URL = f"sqlite:///{database_path.as_posix()}"

SQL_ECHO = os.getenv(
    "SQL_ECHO",
    "false"
).strip().lower() in {
    "1",
    "true",
    "yes",
    "on"
}

engine = create_engine(
    DATABASE_URL,
    connect_args={
        "check_same_thread": False
    },
    echo=SQL_ECHO
)

SessionLocal = sessionmaker(
    autocommit=False,
    autoflush=False,
    bind=engine
)

Base = declarative_base()


def get_db():
    db = SessionLocal()

    try:
        yield db
    finally:
        db.close()
