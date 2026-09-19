import os
import hashlib
import uuid
import re
import math
from pathlib import Path
from datetime import datetime, timezone

from dotenv import load_dotenv

# Load .env before importing database/blockchain/models because those modules
# read storage configuration during import.
load_dotenv()

from fastapi.middleware.cors import CORSMiddleware
from fastapi import FastAPI, Depends, HTTPException, Request
from sqlalchemy.orm import Session
from sqlalchemy import inspect, text
from fastapi.responses import FileResponse
from fastapi.staticfiles import StaticFiles

import json

# Optional Web3/Sepolia anchoring added on the remote branch.
# CITYFILE still boots when Web3 is not installed/configured; local integrity
# records continue to work through blockchain.py.
try:
    from web3 import Web3
except ImportError:
    Web3 = None

RPC_URL = os.getenv("RPC_URL")
PRIVATE_KEY = os.getenv("PRIVATE_KEY")
CONTRACT_ADDRESS = os.getenv("CONTRACT_ADDRESS")

web3 = None
contract = None
account = None

if Web3 is not None and RPC_URL and PRIVATE_KEY and CONTRACT_ADDRESS:
    try:
        web3 = Web3(Web3.HTTPProvider(RPC_URL))
        account = web3.eth.account.from_key(PRIVATE_KEY)
        checksum_address = Web3.to_checksum_address(CONTRACT_ADDRESS)

        abi_path = Path(__file__).resolve().parent / "cityproofs_abi.json"
        with abi_path.open("r", encoding="utf-8") as abi_file:
            contract_abi = json.load(abi_file)

        contract = web3.eth.contract(
            address=checksum_address,
            abi=contract_abi
        )
    except Exception as error:
        print(f"Web3 anchoring could not be initialized: {error}")
        web3 = None
        contract = None
        account = None

from blockchain import blockchain
import models
import schemas

from fastapi import UploadFile, File, Form

# Clerk is optional at import time so the rest of CITYFILE can still boot
# before the dependency/keys are configured. Protected CITYKEEPERS routes
# fail closed until Clerk is available.
try:
    from clerk_backend_api import Clerk
    from clerk_backend_api.security.types import AuthenticateRequestOptions
except ImportError:
    Clerk = None
    AuthenticateRequestOptions = None


from database import get_db, engine, SessionLocal

models.Base.metadata.create_all(bind=engine)

# =========================================================
# LIGHTWEIGHT COMPATIBILITY MIGRATION
# =========================================================
# create_all() does not add new columns to an existing SQLite table.
# This keeps old local databases working after Clerk identity is added.
def ensure_citykeeper_auth_schema():
    inspector = inspect(engine)
    table_names = inspector.get_table_names()

    # =====================================================
    # USERS TABLE
    # =====================================================

    if "users" in table_names:
        user_columns = {
            column["name"]
            for column in inspector.get_columns("users")
        }

        with engine.begin() as connection:
            if "clerk_user_id" not in user_columns:
                connection.execute(
                    text(
                        "ALTER TABLE users "
                        "ADD COLUMN clerk_user_id VARCHAR(255)"
                    )
                )

            connection.execute(
                text(
                    "CREATE UNIQUE INDEX IF NOT EXISTS "
                    "ix_users_clerk_user_id "
                    "ON users (clerk_user_id)"
                )
            )

    # =====================================================
    # EVIDENCE TABLE
    # =====================================================

    if "evidence" in table_names:
        evidence_columns = {
            column["name"]
            for column in inspector.get_columns("evidence")
        }

        with engine.begin() as connection:
            if "uploaded_by_user" not in evidence_columns:
                connection.execute(
                    text(
                        "ALTER TABLE evidence "
                        "ADD COLUMN uploaded_by_user INTEGER"
                    )
                )

            if "uploaded_by_officer" not in evidence_columns:
                connection.execute(
                    text(
                        "ALTER TABLE evidence "
                        "ADD COLUMN uploaded_by_officer INTEGER"
                    )
                )

            if "evidence_type" not in evidence_columns:
                connection.execute(
                    text(
                        "ALTER TABLE evidence "
                        "ADD COLUMN evidence_type VARCHAR(100)"
                    )
                )

            if "file_url" not in evidence_columns:
                connection.execute(
                    text(
                        "ALTER TABLE evidence "
                        "ADD COLUMN file_url VARCHAR(500)"
                    )
                )

            if "file_hash" not in evidence_columns:
                connection.execute(
                    text(
                        "ALTER TABLE evidence "
                        "ADD COLUMN file_hash VARCHAR(255)"
                    )
                )

            if "description" not in evidence_columns:
                connection.execute(
                    text(
                        "ALTER TABLE evidence "
                        "ADD COLUMN description TEXT"
                    )
                )

            if "uploaded_at" not in evidence_columns:
                connection.execute(
                    text(
                        "ALTER TABLE evidence "
                        "ADD COLUMN uploaded_at DATETIME"
                    )
                )


ensure_citykeeper_auth_schema()

# =========================================================
# CLERK CONFIGURATION
# =========================================================

CLERK_PUBLISHABLE_KEY = os.getenv(
    "CLERK_PUBLISHABLE_KEY",
    ""
).strip()

CLERK_SECRET_KEY = os.getenv(
    "CLERK_SECRET_KEY",
    ""
).strip()

CLERK_JWT_KEY = os.getenv(
    "CLERK_JWT_KEY",
    ""
).strip()

CLERK_AUTHORIZED_PARTIES = [
    value.strip()
    for value in os.getenv(
        "CLERK_AUTHORIZED_PARTIES",
        ""
    ).split(",")
    if value.strip()
]

CLERK_AUTHORITY_USER_IDS = {
    value.strip()
    for value in os.getenv(
        "CLERK_AUTHORITY_USER_IDS",
        ""
    ).split(",")
    if value.strip()
}

clerk_client = (
    Clerk(bearer_auth=CLERK_SECRET_KEY)
    if Clerk is not None and CLERK_SECRET_KEY
    else None
)
def ensure_reference_data():
    """Idempotently ensure every supported city has usable reference data."""
    db = SessionLocal()

    try:
        supported_cities = [
            "Delhi",
            "Sonipat",
            "Gurugram",
        ]

        categories = [
            "Pothole",
            "Broken Streetlight",
            "Water Leakage",
            "Overflowing Garbage",
           
        ]

            

        department_names = [
            "Roads",
            "Sanitation",
            "Water Supply",
            "Electricity",
            "Police"
        ]

        for city_name in supported_cities:
            city = db.query(models.City).filter(
                models.City.city_name == city_name
            ).first()

            if not city:
                city = models.City(city_name=city_name)
                db.add(city)
                db.flush()

            existing_departments = {
                department.department_name
                for department in db.query(models.Department).filter(
                    models.Department.city_id == city.city_id
                ).all()
            }

            for department_name in department_names:
                if department_name not in existing_departments:
                    db.add(
                        models.Department(
                            department_name=department_name,
                            city_id=city.city_id
                        )
                    )

        existing_categories = {
            category.category_name
            for category in db.query(models.Category).all()
        }

        for category_name in categories:
            if category_name not in existing_categories:
                db.add(
                    models.Category(
                        category_name=category_name
                    )
                )

        db.commit()
    finally:
        db.close()


ensure_reference_data()


app = FastAPI(
    title="Civic Complaints API",
    description="Backend API for Civic Complaint Management System",
    version="1.0"
)

BASE_DIR = Path(__file__).resolve().parent
ASSETS_DIR = BASE_DIR / "assets"

if not ASSETS_DIR.is_dir():
    raise RuntimeError(
        f"Required assets directory was not found: {ASSETS_DIR}"
    )

app.mount(
    "/assets",
    StaticFiles(directory=str(ASSETS_DIR)),
    name="assets"
)

uploads_setting = os.getenv(
    "UPLOADS_PATH",
    "uploads"
).strip() or "uploads"

UPLOADS_DIR = Path(uploads_setting)
if not UPLOADS_DIR.is_absolute():
    UPLOADS_DIR = BASE_DIR / UPLOADS_DIR

UPLOADS_DIR.mkdir(
    parents=True,
    exist_ok=True
)

app.mount(
    "/uploads",
    StaticFiles(directory=str(UPLOADS_DIR)),
    name="uploads"
)

cors_origins = [
    value.strip()
    for value in os.getenv("CORS_ORIGINS", "*").split(",")
    if value.strip()
]

app.add_middleware(
    CORSMiddleware,
    allow_origins=cors_origins or ["*"],
    # CITYFILE uses bearer tokens, not cross-origin auth cookies. Keeping
    # credentials disabled makes a wildcard development origin valid.
    allow_credentials=False,
    allow_methods=["*"],
    allow_headers=["*"],
)



# =========================================================
# PUBLIC FRONTEND CONFIG + AUTH HELPERS
# =========================================================

@app.get("/config")
def get_public_config():
    return {
        "clerk_enabled": bool(
            CLERK_PUBLISHABLE_KEY and
            CLERK_SECRET_KEY and
            clerk_client is not None
        ),
        "clerk_publishable_key": CLERK_PUBLISHABLE_KEY,
        "authority_access_configured": bool(CLERK_AUTHORITY_USER_IDS)
    }


def require_cityfile_user(
    request: Request,
    db: Session = Depends(get_db)
):
    """
    Verify the Clerk session token sent by the browser and map the
    Clerk subject to a stable CITYFILE user row.
    """

    if (
        clerk_client is None or
        AuthenticateRequestOptions is None or
        not CLERK_SECRET_KEY
    ):
        raise HTTPException(
            status_code=503,
            detail=(
                "Clerk authentication is not configured on the backend."
            )
        )

    options_kwargs = {}

    if CLERK_AUTHORIZED_PARTIES:
        options_kwargs["authorized_parties"] = (
            CLERK_AUTHORIZED_PARTIES
        )

    if CLERK_JWT_KEY:
        options_kwargs["jwt_key"] = CLERK_JWT_KEY

    try:
        request_state = clerk_client.authenticate_request(
            request,
            AuthenticateRequestOptions(
                **options_kwargs
            )
        )
    except Exception as error:
        raise HTTPException(
            status_code=401,
            detail="Could not verify Clerk session."
        ) from error

    is_authenticated = bool(
        getattr(
            request_state,
            "is_authenticated",
            False
        ) or
        getattr(
            request_state,
            "is_signed_in",
            False
        )
    )

    payload = (
        getattr(
            request_state,
            "payload",
            None
        ) or {}
    )

    clerk_user_id = payload.get("sub")

    if (
        not is_authenticated or
        not clerk_user_id
    ):
        raise HTTPException(
            status_code=401,
            detail="Sign in is required."
        )

    user = db.query(
        models.User
    ).filter(
        models.User.clerk_user_id ==
        clerk_user_id
    ).first()

    if user:
        if not user.public_user_id:
            user.public_user_id = (
                f"CK-{user.user_id:06d}"
            )
            db.commit()
            db.refresh(user)

        return user

    # CITYKEEPERS only needs a private auth mapping plus a public CK id.
    # We intentionally do not invent or expose a person's real name.
    user = models.User(
        name=None,
        email=None,
        phone=None,
        public_user_id=None,
        clerk_user_id=clerk_user_id
    )

    db.add(user)
    db.commit()
    db.refresh(user)

    user.public_user_id = (
        f"CK-{user.user_id:06d}"
    )

    db.commit()
    db.refresh(user)

    return user


@app.get("/auth/me")
def get_authenticated_user(
    current_user: models.User = Depends(require_cityfile_user)
):
    return {
        "user_id": current_user.user_id,
        "public_user_id": current_user.public_user_id,
        "is_authority": is_authority_user(current_user)
    }


def is_authority_user(user):
    return bool(
        user and
        user.clerk_user_id and
        user.clerk_user_id in CLERK_AUTHORITY_USER_IDS
    )


def require_authority_user(
    current_user: models.User = Depends(require_cityfile_user)
):
    if not is_authority_user(current_user):
        raise HTTPException(
            status_code=403,
            detail="This action requires an authorized CITYFILE authority account."
        )
    return current_user


def optional_cityfile_user(request: Request, db: Session):
    authorization = str(request.headers.get("authorization") or "").strip()

    if not authorization:
        return None

    # If a browser sends a token, do not silently downgrade an invalid token
    # to anonymous ownership.
    return require_cityfile_user(request, db)


def parse_report_coordinates(location):
    match = re.search(
        r"Latitude:\s*(-?\d+(?:\.\d+)?)\s*,\s*Longitude:\s*(-?\d+(?:\.\d+)?)",
        str(location or ""),
        flags=re.IGNORECASE
    )

    if not match:
        return None, None

    try:
        return float(match.group(1)), float(match.group(2))
    except (TypeError, ValueError):
        return None, None


def serialize_evidence(record):
    return {
        "evidence_id": record.evidence_id,
        "complaint_id": record.complaint_id,
        "uploaded_by_officer": record.uploaded_by_officer,
        "uploaded_by_user": record.uploaded_by_user,
        "evidence_type": record.evidence_type,
        "file_url": record.file_url,
        "file_hash": record.file_hash,
        "description": record.description,
        "uploaded_at": record.uploaded_at
    }


def serialize_update(record):
    return {
        "update_id": record.update_id,
        "complaint_id": record.complaint_id,
        "officer_id": record.officer_id,
        "status": record.status,
        "comment": record.comment,
        "updated_at": record.updated_at
    }


def serialize_resolution_review(review):
    if not review:
        return None

    return {
        "resolution_review_id": review.resolution_review_id,
        "complaint_id": review.complaint_id,
        "attempt_id": review.attempt_id,
        "verified_by_user": review.verified_by_user,
        "action": review.decision,
        "decision": review.decision,
        "reason": review.reason,
        "timestamp": review.created_at,
        "created_at": review.created_at
    }


def resolution_review_for_attempt(db: Session, attempt_id: int):
    return db.query(models.CitizenResolutionReview).filter(
        models.CitizenResolutionReview.attempt_id == attempt_id
    ).first()


def authority_attempts_for_complaint(db: Session, complaint_id: int):
    return db.query(models.AuthorityResolutionAttempt).filter(
        models.AuthorityResolutionAttempt.complaint_id == complaint_id
    ).order_by(
        models.AuthorityResolutionAttempt.created_at.asc(),
        models.AuthorityResolutionAttempt.attempt_id.asc()
    ).all()


def serialize_authority_attempt(db: Session, attempt, ordinal: int):
    review = resolution_review_for_attempt(db, attempt.attempt_id)
    proof = {
        "authority": attempt.authority_label,
        "note": attempt.note,
        "image": attempt.file_url,
        "file_url": attempt.file_url,
        "file_hash": attempt.file_hash,
        "latitude": attempt.latitude,
        "longitude": attempt.longitude,
        "accuracy": attempt.accuracy_m,
        "accuracy_m": attempt.accuracy_m,
        "capturedAt": attempt.captured_at or attempt.created_at,
        "locationCapturedAt": attempt.captured_at or attempt.created_at,
        "created_at": attempt.created_at,
        "attemptNumber": ordinal
    }

    return {
        "attempt": ordinal,
        "attempt_id": attempt.attempt_id,
        "repair_passport_id": f"RP-{int(attempt.attempt_id):06d}",
        "complaint_id": attempt.complaint_id,
        "submitted_by_user_id": attempt.submitted_by_user_id,
        "proof": proof,
        "review": serialize_resolution_review(review)
    }


def append_integrity_event(complaint_id: int, data: dict):
    try:
        return blockchain.add_event(complaint_id, data)
    except Exception as error:
        # Database state remains authoritative if the local hash-chain file is
        # unavailable. The public integrity UI will show the missing anchor
        # rather than inventing one.
        print(f"Integrity event could not be appended for complaint {complaint_id}: {error}")
        return None


# =========================================================
# FAULTLINE — POST-CLOSURE RELATIONSHIP ENGINE
# =========================================================

FAULTLINE_CLOSURE_WATCH_DAYS = 7
FAULTLINE_RECURRENCE_WINDOW_DAYS = 30

# A category-specific spatial radius avoids treating every nearby civic report
# as the same problem. These are conservative hackathon defaults and can be
# tuned later without changing the database model.
FAULTLINE_RADIUS_METERS = {
    "water leakage": 60.0,
    "pothole": 15.0,
    "broken streetlight": 20.0,
    "overflowing garbage": 30.0,
}

FAULTLINE_CLASSIFICATIONS = {
    "recurrence",
    "unresolved_continuation",
    "new_related_fault",
    "unrelated",
    "undetermined",
}


def normalize_faultline_location(value):
    text_value = str(value or "")
    text_value = re.sub(
        r"\|\s*Latitude:\s*-?\d+(?:\.\d+)?\s*,\s*Longitude:\s*-?\d+(?:\.\d+)?",
        "",
        text_value,
        flags=re.IGNORECASE,
    )
    text_value = re.sub(r"\s+", " ", text_value).strip().lower()
    return re.sub(r"[^a-z0-9 ]+", "", text_value).strip()


def haversine_distance_meters(lat1, lon1, lat2, lon2):
    values = [lat1, lon1, lat2, lon2]
    if any(value is None for value in values):
        return None

    try:
        lat1, lon1, lat2, lon2 = [float(value) for value in values]
    except (TypeError, ValueError):
        return None

    earth_radius = 6_371_000.0
    phi1 = math.radians(lat1)
    phi2 = math.radians(lat2)
    delta_phi = math.radians(lat2 - lat1)
    delta_lambda = math.radians(lon2 - lon1)

    a = (
        math.sin(delta_phi / 2) ** 2
        + math.cos(phi1)
        * math.cos(phi2)
        * math.sin(delta_lambda / 2) ** 2
    )
    c = 2 * math.atan2(math.sqrt(a), math.sqrt(max(0.0, 1 - a)))
    return earth_radius * c


def latest_verified_resolution_review(db: Session, complaint_id: int):
    return (
        db.query(models.CitizenResolutionReview)
        .filter(
            models.CitizenResolutionReview.complaint_id == complaint_id,
            models.CitizenResolutionReview.decision == "verified",
        )
        .order_by(
            models.CitizenResolutionReview.created_at.desc(),
            models.CitizenResolutionReview.resolution_review_id.desc(),
        )
        .first()
    )


def complaint_verified_at(db: Session, complaint_id: int):
    review = latest_verified_resolution_review(db, complaint_id)
    return review.created_at if review else None


def faultline_links_for_complaint(db: Session, complaint_id: int):
    records = (
        db.query(models.FaultlineRelationship)
        .filter(
            (models.FaultlineRelationship.previous_complaint_id == complaint_id)
            | (models.FaultlineRelationship.new_complaint_id == complaint_id)
        )
        .order_by(
            models.FaultlineRelationship.created_at.asc(),
            models.FaultlineRelationship.faultline_id.asc(),
        )
        .all()
    )

    return [
        {
            "faultline_id": record.faultline_id,
            "previous_complaint_id": record.previous_complaint_id,
            "new_complaint_id": record.new_complaint_id,
            "role": (
                "previous"
                if record.previous_complaint_id == complaint_id
                else "new"
            ),
            "relationship_status": record.relationship_status,
            "suggested_relation": record.suggested_relation,
            "location_relation": record.location_relation,
            "category_relation": record.category_relation,
            "time_relation": record.time_relation,
            "distance_meters": record.distance_meters,
            "days_since_closure": record.days_since_closure,
            "previous_status": record.previous_status,
            "closure_challenged_at": record.closure_challenged_at,
            "authority_classification": record.authority_classification,
            "authority_explanation": record.authority_explanation,
            "classified_at": record.classified_at,
            "created_at": record.created_at,
        }
        for record in records
    ]


def faultline_escalation_for_links(links):
    incoming = [item for item in links if item.get("role") == "new"]
    if len(incoming) >= 2:
        return "CHRONIC"
    if incoming:
        return "REPEAT"
    if links:
        return "HISTORY"
    return "NORMAL"


def closure_watch_state(db: Session, complaint, links, verified_at):
    if not verified_at:
        return None

    outgoing = [item for item in links if item.get("role") == "previous"]
    if outgoing:
        return {
            "active": False,
            "status": "recurrence_reported",
            "days": None,
            "remaining_days": 0,
        }

    elapsed_days = max(
        0.0,
        (datetime.utcnow() - verified_at).total_seconds() / 86400.0,
    )

    if elapsed_days <= FAULTLINE_CLOSURE_WATCH_DAYS:
        return {
            "active": True,
            "status": "watching",
            "days": round(elapsed_days, 2),
            "remaining_days": round(
                max(0.0, FAULTLINE_CLOSURE_WATCH_DAYS - elapsed_days),
                2,
            ),
        }

    return {
        "active": False,
        "status": "watch_complete",
        "days": round(elapsed_days, 2),
        "remaining_days": 0,
    }


def faultline_location_match(new_complaint, previous_complaint):
    new_lat, new_lon = parse_report_coordinates(new_complaint.location)
    old_lat, old_lon = parse_report_coordinates(previous_complaint.location)

    category_name = (
        str(new_complaint.category.category_name or "").strip().lower()
        if new_complaint.category
        else ""
    )
    radius = FAULTLINE_RADIUS_METERS.get(category_name, 25.0)

    distance = haversine_distance_meters(
        new_lat,
        new_lon,
        old_lat,
        old_lon,
    )

    if distance is not None:
        if distance <= 3:
            relation = "EXACT"
        elif distance <= 10:
            relation = "VERY_CLOSE"
        elif distance <= radius:
            relation = "NEARBY"
        else:
            return None

        return relation, round(distance, 2)

    # Fallback for older records that were submitted before coordinates were
    # captured. Exact normalized text is intentionally conservative.
    new_text = normalize_faultline_location(new_complaint.location)
    old_text = normalize_faultline_location(previous_complaint.location)

    generic_locations = {
        "delhi",
        "new delhi",
        "sonipat",
        "gurugram",
        "gurgaon",
        "rohtak",
        "pinned current location",
    }

    if (
        new_text
        and old_text
        and new_text == old_text
        and new_text not in generic_locations
        and len(new_text) >= 6
    ):
        return "SAME_RECORDED_LOCATION", None

    return None


def detect_faultline_relationships(db: Session, new_complaint):
    """
    Detect relationship candidates after a new complaint is safely stored.
    It never merges records or declares fault. It only creates an auditable
    relationship candidate for later human classification.
    """

    candidates = (
        db.query(models.Complaint)
        .filter(
            models.Complaint.complaint_id != new_complaint.complaint_id,
            models.Complaint.city_id == new_complaint.city_id,
            models.Complaint.category_id == new_complaint.category_id,
        )
        .order_by(
            models.Complaint.created_at.desc(),
            models.Complaint.complaint_id.desc(),
        )
        .limit(100)
        .all()
    )

    created = []

    for previous in candidates:
        location_match = faultline_location_match(new_complaint, previous)
        if not location_match:
            continue

        location_relation, distance_meters = location_match
        previous_status = str(previous.status or "Submitted").strip()
        previous_status_key = previous_status.lower()

        verified_at = complaint_verified_at(db, previous.complaint_id)
        days_since_closure = None
        closure_challenged_at = None

        if verified_at or previous_status_key in {"verified", "closed"}:
            if verified_at and new_complaint.created_at:
                days_since_closure = max(
                    0.0,
                    (new_complaint.created_at - verified_at).total_seconds()
                    / 86400.0,
                )

            if days_since_closure is None:
                # Legacy closed records may not have a persisted citizen-review
                # timestamp. Keep the relationship visible without inventing a
                # repair-survival duration.
                suggested_relation = "possible_recurrence"
                closure_challenged_at = datetime.utcnow()
                time_relation = "CLOSED_TIME_UNKNOWN"
            elif days_since_closure <= FAULTLINE_RECURRENCE_WINDOW_DAYS:
                suggested_relation = "possible_recurrence"
                closure_challenged_at = datetime.utcnow()
                time_relation = (
                    "CLOSURE_WATCH"
                    if days_since_closure <= FAULTLINE_CLOSURE_WATCH_DAYS
                    else "RECENT_CLOSURE"
                )
            else:
                suggested_relation = "historically_related"
                time_relation = "HISTORICAL_CLOSURE"
        else:
            suggested_relation = "possible_unresolved_continuation"
            time_relation = "ACTIVE_PREVIOUS_RECORD"

        existing = (
            db.query(models.FaultlineRelationship)
            .filter(
                models.FaultlineRelationship.previous_complaint_id
                == previous.complaint_id,
                models.FaultlineRelationship.new_complaint_id
                == new_complaint.complaint_id,
            )
            .first()
        )
        if existing:
            continue

        relationship = models.FaultlineRelationship(
            previous_complaint_id=previous.complaint_id,
            new_complaint_id=new_complaint.complaint_id,
            relationship_status="under_review",
            suggested_relation=suggested_relation,
            location_relation=location_relation,
            category_relation="EXACT",
            time_relation=time_relation,
            distance_meters=distance_meters,
            days_since_closure=(
                round(days_since_closure, 3)
                if days_since_closure is not None
                else None
            ),
            previous_status=previous_status,
            closure_challenged_at=closure_challenged_at,
        )
        db.add(relationship)
        db.flush()
        created.append(relationship)

    if not created:
        return []

    db.commit()

    for relationship in created:
        append_integrity_event(
            relationship.new_complaint_id,
            {
                "event": "faultline_relationship_detected",
                "faultline_id": relationship.faultline_id,
                "previous_complaint_id": relationship.previous_complaint_id,
                "suggested_relation": relationship.suggested_relation,
                "location_relation": relationship.location_relation,
                "distance_meters": relationship.distance_meters,
                "days_since_closure": relationship.days_since_closure,
            },
        )

        # The previous record is not reopened or rewritten. This event simply
        # records that later evidence challenged the finality of its closure.
        if relationship.closure_challenged_at:
            append_integrity_event(
                relationship.previous_complaint_id,
                {
                    "event": "closure_challenged_by_later_report",
                    "faultline_id": relationship.faultline_id,
                    "new_complaint_id": relationship.new_complaint_id,
                },
            )

    return created


def serialize_faultline_case(db: Session, relationship):
    previous = db.query(models.Complaint).filter(
        models.Complaint.complaint_id == relationship.previous_complaint_id
    ).first()
    current = db.query(models.Complaint).filter(
        models.Complaint.complaint_id == relationship.new_complaint_id
    ).first()

    return {
        "faultline_id": relationship.faultline_id,
        "relationship_status": relationship.relationship_status,
        "suggested_relation": relationship.suggested_relation,
        "location_relation": relationship.location_relation,
        "category_relation": relationship.category_relation,
        "time_relation": relationship.time_relation,
        "distance_meters": relationship.distance_meters,
        "days_since_closure": relationship.days_since_closure,
        "previous_status": relationship.previous_status,
        "closure_challenged_at": relationship.closure_challenged_at,
        "authority_classification": relationship.authority_classification,
        "authority_explanation": relationship.authority_explanation,
        "classified_at": relationship.classified_at,
        "created_at": relationship.created_at,
        "previous_complaint": serialize_complaint(db, previous) if previous else None,
        "new_complaint": serialize_complaint(db, current) if current else None,
    }


def serialize_complaint(db: Session, complaint):
    attempts = authority_attempts_for_complaint(db, complaint.complaint_id)
    serialized_attempts = [
        serialize_authority_attempt(db, attempt, index + 1)
        for index, attempt in enumerate(attempts)
    ]

    updates = db.query(models.ComplaintUpdate).filter(
        models.ComplaintUpdate.complaint_id == complaint.complaint_id
    ).order_by(
        models.ComplaintUpdate.updated_at.asc(),
        models.ComplaintUpdate.update_id.asc()
    ).all()

    evidence = db.query(models.Evidence).filter(
        models.Evidence.complaint_id == complaint.complaint_id
    ).order_by(
        models.Evidence.uploaded_at.asc(),
        models.Evidence.evidence_id.asc()
    ).all()

    anchor = blockchain.complaint_anchor(complaint.complaint_id)
    chain_events = blockchain.complaint_blocks(complaint.complaint_id)
    latitude, longitude = parse_report_coordinates(complaint.location)
    faultline_links = faultline_links_for_complaint(
        db, complaint.complaint_id
    )
    verified_at = complaint_verified_at(
        db, complaint.complaint_id
    )

    return {
        "complaint_id": complaint.complaint_id,
        "user_id": complaint.user_id,
        "city_id": complaint.city_id,
        "category_id": complaint.category_id,
        "department_id": complaint.department_id,
        "city_name": complaint.city.city_name if complaint.city else None,
        "category_name": complaint.category.category_name if complaint.category else None,
        "department_name": complaint.department.department_name if complaint.department else None,
        "description": complaint.description,
        "location": complaint.location,
        "latitude": latitude,
        "longitude": longitude,
        "priority": complaint.priority,
        "status": complaint.status,
        "created_at": complaint.created_at,
        "deadline": complaint.deadline,
        "verified_at": verified_at,
        "faultline_links": faultline_links,
        "faultline_escalation": faultline_escalation_for_links(
            faultline_links
        ),
        "closure_watch": closure_watch_state(
            db, complaint, faultline_links, verified_at
        ),
        "blockchain_hash": anchor.hash if anchor else None,
        "block_index": anchor.index if anchor else None,
        "integrity_type": "local_sha256_hash_chain",
        "integrity_verified": bool(blockchain.verify_chain()),
        "integrity_error": blockchain.integrity_error,
        "citykeeper_eligible": citykeeper_community_eligible(complaint),
        "integrity_events": [
            {
                "index": block.index,
                "timestamp": block.timestamp,
                "previous_hash": block.previous_hash,
                "hash": block.hash,
                "data": block.data
            }
            for block in chain_events
        ],
        "updates": [serialize_update(update) for update in updates],
        "evidence": [serialize_evidence(item) for item in evidence],
        "resolution_attempts": serialized_attempts,
        "latest_authority_resolution": (
            serialized_attempts[-1] if serialized_attempts else None
        )
    }


def latest_authority_attempt(db: Session, complaint_id: int):
    return db.query(models.AuthorityResolutionAttempt).filter(
        models.AuthorityResolutionAttempt.complaint_id == complaint_id
    ).order_by(
        models.AuthorityResolutionAttempt.created_at.desc(),
        models.AuthorityResolutionAttempt.attempt_id.desc()
    ).first()


def parse_client_datetime(value):
    if not value:
        return None

    raw = str(value).strip()

    if raw.endswith("Z"):
        raw = raw[:-1] + "+00:00"

    try:
        parsed = datetime.fromisoformat(raw)
    except ValueError as error:
        raise HTTPException(
            status_code=400,
            detail="Invalid captured_at timestamp."
        ) from error

    if parsed.tzinfo is not None:
        parsed = parsed.astimezone(timezone.utc).replace(tzinfo=None)

    return parsed


def citykeeper_community_eligible(
    complaint
):
    """
    Backend mirror of the frontend safety boundary:
    only community-safe cleanup/public-space care is eligible.
    """

    if complaint is None:
        return False

    status = str(
        complaint.status or ""
    ).strip().lower()

    if status in {
        "resolved",
        "verified",
        "closed"
    }:
        return False

    category_name = ""

    try:
        if complaint.category:
            category_name = str(
                complaint.category.category_name or ""
            )
    except Exception:
        category_name = ""

    text_value = " ".join([
        category_name,
        str(complaint.description or ""),
        str(complaint.location or "")
    ]).lower()

    # Keep infrastructure and safety work with trained authorities.
    blocked_patterns = [
        r"\bpothole\b",
        r"\broad repair\b",
        r"\bstreetlight\b",
        r"\bstreet light\b",
        r"\belectric",
        r"\bwater leak",
        r"\bpipeline\b",
        r"\bdrain",
        r"\bsewage\b",
        r"\bsewer\b",
        r"\bunsafe road\b",
        r"\bpolice\b",
        r"\bcrime\b"
    ]

    if any(
        re.search(
            pattern,
            text_value
        )
        for pattern in blocked_patterns
    ):
        return False

    if (
        "garbage" in category_name.lower() or
        "sanitation" in category_name.lower()
    ):
        return True

    return bool(
        re.search(
            (
                r"park|garden|public space|litter|garbage|"
                r"trash|waste|graffiti|wall|tree|plant|"
                r"clean(?:ing|up)?|playground|community space"
            ),
            text_value
        )
    )


def latest_citykeeper_evidence(
    db: Session,
    complaint_id: int
):
    return db.query(
        models.Evidence
    ).filter(
        models.Evidence.complaint_id ==
        complaint_id,
        models.Evidence.evidence_type ==
        "citykeeper_after"
    ).order_by(
        models.Evidence.uploaded_at.desc(),
        models.Evidence.evidence_id.desc()
    ).first()


def citykeeper_verification_for_evidence(
    db: Session,
    evidence_id: int
):
    return db.query(
        models.CitykeeperVerification
    ).filter(
        models.CitykeeperVerification.evidence_id ==
        evidence_id
    ).order_by(
        models.CitykeeperVerification.created_at.desc(),
        models.CitykeeperVerification.verification_id.desc()
    ).first()


def serialize_citykeeper_verification(
    verification
):
    if not verification:
        return None

    return {
        "verification_id":
            verification.verification_id,
        "complaint_id":
            verification.complaint_id,
        "evidence_id":
            verification.evidence_id,
        "verified_by_user":
            verification.verified_by_user,
        "decision":
            verification.decision,
        "created_at":
            verification.created_at
    }


# =========================================================
# HOME / TEST
# =========================================================

@app.get("/")
def home(): 
    return FileResponse(str(BASE_DIR / "index.html"))

@app.get("/style.css")
def style():
    return FileResponse(str(BASE_DIR / "style.css"), media_type="text/css")


@app.get("/script.js")
def script():
    return FileResponse(str(BASE_DIR / "script.js"), media_type="application/javascript")


# =========================================================
# USERS
# =========================================================

@app.post("/users")
def create_user(
    user: schemas.UserCreate,
    current_user: models.User = Depends(require_authority_user),
    db: Session = Depends(get_db)
):
    new_user = models.User(
        name=user.name,
        email=user.email,
        phone=user.phone,
        public_user_id=user.public_user_id
    )

    db.add(new_user)
    db.commit()
    db.refresh(new_user)

    return new_user


@app.get("/users")
def get_users(
    current_user: models.User = Depends(require_authority_user),
    db: Session = Depends(get_db)
):
    return db.query(models.User).all()


@app.get("/users/{user_id}")
def get_user(
    user_id: int,
    current_user: models.User = Depends(require_authority_user),
    db: Session = Depends(get_db)
):
    user = db.query(models.User).filter(
        models.User.user_id == user_id
    ).first()

    if not user:
        raise HTTPException(
            status_code=404,
            detail="User not found"
        )

    return user


# =========================================================
# CITIES
# =========================================================

@app.get("/cities")
def get_cities(db: Session = Depends(get_db)):
    return db.query(models.City).all()


# =========================================================
# CATEGORIES
# =========================================================

@app.get("/categories")
def get_categories(db: Session = Depends(get_db)):
    return db.query(models.Category).all()


# =========================================================
# DEPARTMENTS
# =========================================================

@app.get("/departments")
def get_departments(db: Session = Depends(get_db)):
    return db.query(models.Department).all()


@app.get("/departments/{department_id}")
def get_department(
    department_id: int,
    db: Session = Depends(get_db)
):
    department = db.query(models.Department).filter(
        models.Department.department_id == department_id
    ).first()

    if not department:
        raise HTTPException(
            status_code=404,
            detail="Department not found"
        )

    return department


# =========================================================
# OFFICERS
# =========================================================

@app.get("/officers")
def get_officers(db: Session = Depends(get_db)):
    return db.query(models.Officer).all()


@app.get("/officers/{officer_id}")
def get_officer(
    officer_id: int,
    db: Session = Depends(get_db)
):
    officer = db.query(models.Officer).filter(
        models.Officer.officer_id == officer_id
    ).first()

    if not officer:
        raise HTTPException(
            status_code=404,
            detail="Officer not found"
        )

    return officer


# =========================================================
# COMPLAINTS
# =========================================================

def validate_complaint_references(db: Session, complaint: schemas.ComplaintCreate):
    city = db.query(models.City).filter(
        models.City.city_id == complaint.city_id
    ).first()
    category = db.query(models.Category).filter(
        models.Category.category_id == complaint.category_id
    ).first()
    department = db.query(models.Department).filter(
        models.Department.department_id == complaint.department_id
    ).first()

    if not city:
        raise HTTPException(status_code=400, detail="Select a valid city.")
    if not category:
        raise HTTPException(status_code=400, detail="Select a valid category.")
    if not department:
        raise HTTPException(status_code=400, detail="Select a valid department.")
    if department.city_id and department.city_id != city.city_id:
        raise HTTPException(
            status_code=400,
            detail="The selected department does not belong to the selected city."
        )

    if not str(complaint.description or "").strip():
        raise HTTPException(status_code=400, detail="Complaint description is required.")
    if not str(complaint.location or "").strip():
        raise HTTPException(status_code=400, detail="Complaint location is required.")

    priority = str(complaint.priority or "Medium").strip().title()
    if priority not in {"Low", "Medium", "High"}:
        raise HTTPException(status_code=400, detail="Priority must be Low, Medium or High.")

    return priority


@app.post("/complaints")
def create_complaint(
    complaint: schemas.ComplaintCreate,
    request: Request,
    db: Session = Depends(get_db)
):
    priority = validate_complaint_references(db, complaint)
    current_user = optional_cityfile_user(request, db)

    new_complaint = models.Complaint(
        # Ownership is derived from Clerk, never from a client-supplied user_id.
        user_id=current_user.user_id if current_user else None,
        city_id=complaint.city_id,
        category_id=complaint.category_id,
        department_id=complaint.department_id,
        description=str(complaint.description).strip(),
        location=str(complaint.location).strip(),
        priority=priority,
        status="Submitted",
        deadline=complaint.deadline
    )

    db.add(new_complaint)
    db.flush()

    if any([
        complaint.reporter_name,
        complaint.reporter_email,
        complaint.reporter_phone,
        complaint.reporter_public_user_id
    ]):
        db.add(
            models.ComplaintReporter(
                complaint_id=new_complaint.complaint_id,
                name=(complaint.reporter_name or "").strip() or None,
                email=(complaint.reporter_email or "").strip() or None,
                phone=(complaint.reporter_phone or "").strip() or None,
                public_user_id=(
                    complaint.reporter_public_user_id or ""
                ).strip() or None
            )
        )

    db.commit()
    db.refresh(new_complaint)

    block = append_integrity_event(
        new_complaint.complaint_id,
        {
            "event": "complaint_created",
            "description": new_complaint.description,
            "location": new_complaint.location,
            "priority": new_complaint.priority,
            "status": new_complaint.status
        }
    )

    # Detect historical relationships only after the independent complaint and
    # its creation anchor exist. A match never prevents submission or merges IDs.
    detect_faultline_relationships(db, new_complaint)

    # serialize_complaint looks up the first complaint block, so a failed local
    # hash-chain append simply appears as unanchored rather than being faked.
    return serialize_complaint(db, new_complaint)


@app.get("/complaints")
def get_complaints(db: Session = Depends(get_db)):
    complaints = db.query(models.Complaint).order_by(
        models.Complaint.created_at.desc(),
        models.Complaint.complaint_id.desc()
    ).all()

    return [serialize_complaint(db, complaint) for complaint in complaints]


@app.get("/me/complaints")
def get_my_complaints(
    current_user: models.User = Depends(require_cityfile_user),
    db: Session = Depends(get_db)
):
    complaints = db.query(models.Complaint).filter(
        models.Complaint.user_id == current_user.user_id
    ).order_by(
        models.Complaint.created_at.desc(),
        models.Complaint.complaint_id.desc()
    ).all()

    return [serialize_complaint(db, complaint) for complaint in complaints]


@app.get("/complaints/{complaint_id}")
def get_complaint(
    complaint_id: int,
    db: Session = Depends(get_db)
):
    complaint = db.query(models.Complaint).filter(
        models.Complaint.complaint_id == complaint_id
    ).first()

    if not complaint:
        raise HTTPException(status_code=404, detail="Complaint not found")

    return serialize_complaint(db, complaint)


@app.put("/complaints/{complaint_id}")
def update_complaint(
    complaint_id: int,
    data: schemas.ComplaintUpdateSchema,
    current_user: models.User = Depends(require_authority_user),
    db: Session = Depends(get_db)
):
    complaint = db.query(models.Complaint).filter(
        models.Complaint.complaint_id == complaint_id
    ).first()

    if not complaint:
        raise HTTPException(status_code=404, detail="Complaint not found")

    if str(complaint.status or "").lower() in {"verified", "closed"}:
        raise HTTPException(
            status_code=409,
            detail="A citizen-verified complaint cannot be silently reopened by authority."
        )

    old_status = complaint.status

    if data.status is not None:
        latest_attempt = latest_authority_attempt(db, complaint_id)
        if latest_attempt and not resolution_review_for_attempt(db, latest_attempt.attempt_id):
            raise HTTPException(
                status_code=409,
                detail="This complaint is awaiting citizen verification of the latest proof."
            )

        status_key = str(data.status).strip().lower().replace("_", " ")
        allowed = {
            "acknowledged": "Acknowledged",
            "in progress": "In Progress"
        }

        if status_key not in allowed:
            raise HTTPException(
                status_code=400,
                detail=(
                    "Authority may directly set only Acknowledged or In Progress. "
                    "Resolution requires proof and citizen verification."
                )
            )

        new_status = allowed[status_key]
        if complaint.status != new_status:
            complaint.status = new_status
            db.add(
                models.ComplaintUpdate(
                    complaint_id=complaint_id,
                    officer_id=None,
                    status=new_status,
                    comment="Authority status update"
                )
            )

    if data.priority is not None:
        priority = str(data.priority).strip().title()
        if priority not in {"Low", "Medium", "High"}:
            raise HTTPException(
                status_code=400,
                detail="Priority must be Low, Medium or High."
            )
        complaint.priority = priority

    if data.deadline is not None:
        complaint.deadline = data.deadline

    db.commit()
    db.refresh(complaint)

    append_integrity_event(
        complaint_id,
        {
            "event": "authority_status_updated",
            "old_status": old_status,
            "status": complaint.status,
            "priority": complaint.priority,
            "deadline": complaint.deadline.isoformat() if complaint.deadline else None,
            "authority_user_id": current_user.user_id
        }
    )

    return serialize_complaint(db, complaint)


# =========================================================
# COMPLAINT ASSIGNMENTS
# =========================================================

@app.post("/assignments")
def assign_complaint(
    assignment: schemas.AssignmentCreate,
    current_user: models.User = Depends(require_authority_user),
    db: Session = Depends(get_db)
):
    complaint = db.query(models.Complaint).filter(
        models.Complaint.complaint_id == assignment.complaint_id
    ).first()
    officer = db.query(models.Officer).filter(
        models.Officer.officer_id == assignment.officer_id
    ).first()

    if not complaint:
        raise HTTPException(status_code=404, detail="Complaint not found")
    if not officer:
        raise HTTPException(status_code=404, detail="Officer not found")

    new_assignment = models.ComplaintAssignment(
        complaint_id=assignment.complaint_id,
        officer_id=assignment.officer_id
    )

    db.add(new_assignment)
    db.commit()
    db.refresh(new_assignment)

    append_integrity_event(
        assignment.complaint_id,
        {
            "event": "complaint_assigned",
            "officer_id": assignment.officer_id,
            "authority_user_id": current_user.user_id
        }
    )

    return new_assignment


@app.get("/assignments")
def get_assignments(
    current_user: models.User = Depends(require_authority_user),
    db: Session = Depends(get_db)
):
    return db.query(models.ComplaintAssignment).all()


# =========================================================
# COMPLAINT UPDATES
# =========================================================
@app.post("/complaint-updates")
def create_complaint_update(
    update: schemas.ComplaintUpdateCreate,
    current_user: models.User = Depends(require_authority_user),
    db: Session = Depends(get_db)
):
    complaint = db.query(models.Complaint).filter(
        models.Complaint.complaint_id == update.complaint_id
    ).first()

    if not complaint:
        raise HTTPException(status_code=404, detail="Complaint not found")

    latest_attempt = latest_authority_attempt(db, update.complaint_id)
    if latest_attempt and not resolution_review_for_attempt(db, latest_attempt.attempt_id):
        raise HTTPException(
            status_code=409,
            detail="This complaint is awaiting citizen verification of the latest proof."
        )

    status_key = str(update.status or "").strip().lower().replace("_", " ")
    allowed = {
        "acknowledged": "Acknowledged",
        "in progress": "In Progress"
    }
    if status_key not in allowed:
        raise HTTPException(
            status_code=400,
            detail=(
                "Use the authority resolution endpoint for a completed fix; "
                "citizen verification controls final closure."
            )
        )

    canonical_status = allowed[status_key]

    new_update = models.ComplaintUpdate(
        complaint_id=update.complaint_id,
        officer_id=update.officer_id,
        status=canonical_status,
        comment=update.comment
    )
    complaint.status = canonical_status

    db.add(new_update)
    db.commit()
    db.refresh(new_update)

    append_integrity_event(
        update.complaint_id,
        {
            "event": "authority_status_updated",
            "status": canonical_status,
            "comment": update.comment,
            "officer_id": update.officer_id,
            "authority_user_id": current_user.user_id
        }
    )

    return new_update


@app.get("/complaints/{complaint_id}/updates")
def get_complaint_updates(
    complaint_id: int,
    db: Session = Depends(get_db)
):
    return db.query(models.ComplaintUpdate).filter(
        models.ComplaintUpdate.complaint_id == complaint_id
    ).order_by(
        models.ComplaintUpdate.updated_at.asc(),
        models.ComplaintUpdate.update_id.asc()
    ).all()

# =========================================================
# WEB3 EVIDENCE ANCHORING
# =========================================================

def register_evidence_on_web3(
    complaint_id: int,
    evidence_hash: str,
    evidence_type: str
):
    if not web3 or not contract or not account or not PRIVATE_KEY:
        return None

    nonce = web3.eth.get_transaction_count(account.address)

    transaction = contract.functions.registerEvidence(
        int(complaint_id),
        evidence_hash,
        evidence_type
    ).build_transaction({
        "from": account.address,
        "nonce": nonce,
        "gas": 200000,
        "gasPrice": web3.eth.gas_price,
        "chainId": web3.eth.chain_id
    })

    signed_transaction = web3.eth.account.sign_transaction(
        transaction,
        PRIVATE_KEY
    )

    raw_transaction = getattr(
        signed_transaction,
        "raw_transaction",
        getattr(signed_transaction, "rawTransaction", None)
    )

    if raw_transaction is None:
        raise RuntimeError("Could not read signed Web3 transaction bytes.")

    transaction_hash = web3.eth.send_raw_transaction(raw_transaction)
    receipt = web3.eth.wait_for_transaction_receipt(transaction_hash)

    return {
        "transaction_hash": transaction_hash.hex(),
        "block_number": receipt.blockNumber,
        "evidence_hash": evidence_hash
    }


PRIVILEGED_EVIDENCE_TYPES = {
    "citykeeper_after",
    "authority_resolution",
    "authority_proof"
}


@app.post("/evidence")
def add_evidence(
    evidence: schemas.EvidenceCreate,
    request: Request,
    db: Session = Depends(get_db)
):
    normalized_type = str(
        evidence.evidence_type or "citizen_report"
    ).strip().lower()

    if normalized_type in PRIVILEGED_EVIDENCE_TYPES:
        raise HTTPException(
            status_code=403,
            detail="Use the workflow-specific authenticated evidence endpoint."
        )

    complaint = db.query(models.Complaint).filter(
        models.Complaint.complaint_id == evidence.complaint_id
    ).first()

    if not complaint:
        raise HTTPException(status_code=404, detail="Complaint not found")

    current_user = optional_cityfile_user(request, db)

    new_evidence = models.Evidence(
        complaint_id=evidence.complaint_id,
        uploaded_by_officer=None,
        uploaded_by_user=current_user.user_id if current_user else None,
        evidence_type=normalized_type,
        file_url=evidence.file_url,
        file_hash=evidence.file_hash,
        description=evidence.description
    )

    db.add(new_evidence)
    db.commit()
    db.refresh(new_evidence)

    append_integrity_event(
        evidence.complaint_id,
        {
            "event": "evidence_added",
            "evidence_id": new_evidence.evidence_id,
            "evidence_type": normalized_type,
            "file_hash": new_evidence.file_hash
        }
    )

    return serialize_evidence(new_evidence)


@app.get("/complaints/{complaint_id}/evidence")
def get_evidence(
    complaint_id: int,
    db: Session = Depends(get_db)
):
    return db.query(models.Evidence).filter(
        models.Evidence.complaint_id == complaint_id
    ).order_by(
        models.Evidence.uploaded_at.asc(),
        models.Evidence.evidence_id.asc()
    ).all()


async def store_complaint_image_evidence(
    *,
    complaint_id: int,
    file: UploadFile,
    evidence_type: str,
    uploaded_by_user: int | None,
    uploaded_by_officer: int | None,
    description: str | None,
    db: Session
):
    complaint = db.query(models.Complaint).filter(
        models.Complaint.complaint_id == complaint_id
    ).first()

    if not complaint:
        raise HTTPException(status_code=404, detail="Complaint not found")

    if not file.content_type or not file.content_type.startswith("image/"):
        raise HTTPException(status_code=400, detail="Only image files are allowed")

    contents = await file.read()

    if not contents:
        raise HTTPException(status_code=400, detail="Empty image")

    if len(contents) > 10 * 1024 * 1024:
        raise HTTPException(
            status_code=400,
            detail="Image is too large (maximum 10 MB)"
        )

    file_hash = hashlib.sha256(contents).hexdigest()
    extension = os.path.splitext(file.filename or "")[1].lower()
    allowed_extensions = {".jpg", ".jpeg", ".png", ".webp"}

    if extension not in allowed_extensions:
        raise HTTPException(status_code=400, detail="Unsupported image format")

    complaint_folder = os.path.join(
        UPLOADS_DIR,
        "complaints",
        str(complaint_id)
    )
    os.makedirs(complaint_folder, exist_ok=True)

    filename = f"{evidence_type}_{uuid.uuid4().hex}{extension}"
    file_path = os.path.join(complaint_folder, filename)

    with open(file_path, "wb") as buffer:
        buffer.write(contents)

    file_url = f"/uploads/complaints/{complaint_id}/{filename}"

    new_evidence = models.Evidence(
        complaint_id=complaint_id,
        uploaded_by_user=uploaded_by_user,
        uploaded_by_officer=uploaded_by_officer,
        evidence_type=evidence_type,
        file_url=file_url,
        file_hash=file_hash,
        description=description
    )

    db.add(new_evidence)
    db.commit()
    db.refresh(new_evidence)

    append_integrity_event(
        complaint_id,
        {
            "event": "evidence_added",
            "evidence_id": new_evidence.evidence_id,
            "evidence_type": evidence_type,
            "file_hash": file_hash
        }
    )

    serialized = serialize_evidence(new_evidence)

    # Preserve the remote branch's Sepolia evidence anchoring, but only for
    # authenticated authority proof types. A Web3 outage must not erase the
    # database/local-hash-chain record that was already created.
    if evidence_type in {"authority_resolution", "authority_proof"} and file_hash:
        try:
            web3_result = register_evidence_on_web3(
                complaint_id,
                file_hash,
                "resolution"
            )
        except Exception as error:
            print(
                f"Web3 evidence anchor failed for complaint {complaint_id}: {error}"
            )
            web3_result = None

        if web3_result:
            serialized["web3_transaction_hash"] = web3_result["transaction_hash"]
            serialized["web3_block_number"] = web3_result["block_number"]
            serialized["web3_evidence_hash"] = web3_result["evidence_hash"]

    return serialized


@app.post("/complaints/{complaint_id}/evidence/upload")
async def upload_complaint_evidence(
    complaint_id: int,
    request: Request,
    file: UploadFile = File(...),
    evidence_type: str = Form("citizen_report"),
    uploaded_by_user: int | None = Form(None),
    uploaded_by_officer: int | None = Form(None),
    description: str | None = Form(None),
    db: Session = Depends(get_db)
):
    normalized_type = str(evidence_type or "citizen_report").strip().lower()

    if normalized_type in PRIVILEGED_EVIDENCE_TYPES:
        raise HTTPException(
            status_code=403,
            detail="Use the workflow-specific authenticated evidence endpoint."
        )

    if uploaded_by_officer is not None:
        raise HTTPException(
            status_code=403,
            detail="Officer ownership cannot be supplied by the browser."
        )

    current_user = optional_cityfile_user(request, db)

    return await store_complaint_image_evidence(
        complaint_id=complaint_id,
        file=file,
        evidence_type=normalized_type,
        uploaded_by_user=current_user.user_id if current_user else None,
        uploaded_by_officer=None,
        description=description,
        db=db
    )


# =========================================================
# AUTHORITY RESOLUTION + CITIZEN VERIFICATION
# =========================================================

@app.post("/authority/complaints/{complaint_id}/resolution")
async def submit_authority_resolution(
    complaint_id: int,
    file: UploadFile = File(...),
    authority_label: str = Form(...),
    note: str = Form(...),
    latitude: float = Form(...),
    longitude: float = Form(...),
    accuracy_m: float | None = Form(None),
    captured_at: str | None = Form(None),
    current_user: models.User = Depends(require_authority_user),
    db: Session = Depends(get_db)
):
    complaint = db.query(models.Complaint).filter(
        models.Complaint.complaint_id == complaint_id
    ).first()

    if not complaint:
        raise HTTPException(status_code=404, detail="Complaint not found")

    if str(complaint.status or "").strip().lower() in {"verified", "closed"}:
        raise HTTPException(status_code=409, detail="This complaint is already citizen verified.")

    authority_label = str(authority_label or "").strip()
    note = str(note or "").strip()
    if not authority_label or not note:
        raise HTTPException(status_code=400, detail="Authority label and work note are required.")

    latest_attempt = latest_authority_attempt(db, complaint_id)
    if latest_attempt:
        latest_review = resolution_review_for_attempt(db, latest_attempt.attempt_id)
        if not latest_review:
            raise HTTPException(
                status_code=409,
                detail="The latest resolution attempt is still awaiting citizen verification."
            )
        if latest_review.decision == "verified":
            raise HTTPException(status_code=409, detail="This complaint is already citizen verified.")
        if latest_review.decision not in {"questioned", "reopened"}:
            raise HTTPException(status_code=409, detail="The latest resolution attempt cannot be replaced.")

    evidence_record = await store_complaint_image_evidence(
        complaint_id=complaint_id,
        file=file,
        evidence_type="authority_resolution",
        uploaded_by_user=current_user.user_id,
        uploaded_by_officer=None,
        description=note,
        db=db
    )

    attempt = models.AuthorityResolutionAttempt(
        complaint_id=complaint_id,
        submitted_by_user_id=current_user.user_id,
        authority_label=authority_label,
        note=note,
        file_url=evidence_record["file_url"],
        file_hash=evidence_record["file_hash"],
        latitude=latitude,
        longitude=longitude,
        accuracy_m=accuracy_m,
        captured_at=parse_client_datetime(captured_at) or datetime.utcnow()
    )

    complaint.status = "Awaiting Verification"
    db.add(attempt)
    db.add(
        models.ComplaintUpdate(
            complaint_id=complaint_id,
            officer_id=None,
            status="Awaiting Verification",
            comment=note
        )
    )
    db.commit()
    db.refresh(attempt)
    db.refresh(complaint)

    append_integrity_event(
        complaint_id,
        {
            "event": "authority_resolution_submitted",
            "attempt_id": attempt.attempt_id,
            "file_hash": attempt.file_hash,
            "latitude": attempt.latitude,
            "longitude": attempt.longitude,
            "status": complaint.status
        }
    )

    return serialize_complaint(db, complaint)


@app.post("/complaints/{complaint_id}/resolution-review")
def review_authority_resolution(
    complaint_id: int,
    review_data: schemas.ResolutionReviewCreate,
    current_user: models.User = Depends(require_cityfile_user),
    db: Session = Depends(get_db)
):
    if is_authority_user(current_user):
        raise HTTPException(
            status_code=403,
            detail="Authority accounts cannot perform the citizen verification step."
        )

    complaint = db.query(models.Complaint).filter(
        models.Complaint.complaint_id == complaint_id
    ).first()
    if not complaint:
        raise HTTPException(status_code=404, detail="Complaint not found")

    attempt = latest_authority_attempt(db, complaint_id)
    if not attempt:
        raise HTTPException(status_code=404, detail="No authority resolution proof is awaiting review.")

    existing = resolution_review_for_attempt(db, attempt.attempt_id)
    if existing:
        return {
            "already_decided": True,
            "review": serialize_resolution_review(existing),
            "complaint": serialize_complaint(db, complaint)
        }

    decision = str(review_data.decision or "").strip().lower()
    if decision not in {"verified", "questioned", "reopened"}:
        raise HTTPException(
            status_code=400,
            detail="Decision must be verified, questioned or reopened."
        )

    reason = str(review_data.reason or "").strip()
    if decision in {"questioned", "reopened"} and not reason:
        raise HTTPException(
            status_code=400,
            detail="A reason is required when the proof is questioned or the issue still exists."
        )

    if decision == "verified" and not reason:
        reason = "Citizen verified the authority resolution evidence."

    review = models.CitizenResolutionReview(
        complaint_id=complaint_id,
        attempt_id=attempt.attempt_id,
        verified_by_user=current_user.user_id,
        decision=decision,
        reason=reason
    )

    new_status = "Verified" if decision == "verified" else "Disputed"
    complaint.status = new_status

    db.add(review)
    db.add(
        models.ComplaintUpdate(
            complaint_id=complaint_id,
            officer_id=None,
            status=new_status,
            comment=f"Citizen resolution review: {decision}. {reason}"
        )
    )
    db.commit()
    db.refresh(review)
    db.refresh(complaint)

    append_integrity_event(
        complaint_id,
        {
            "event": "citizen_resolution_reviewed",
            "attempt_id": attempt.attempt_id,
            "resolution_review_id": review.resolution_review_id,
            "decision": decision,
            "status": new_status
        }
    )

    return {
        "already_decided": False,
        "review": serialize_resolution_review(review),
        "complaint": serialize_complaint(db, complaint)
    }


# =========================================================
# FAULTLINE API
# =========================================================

@app.get("/faultline")
def get_faultline_cases(db: Session = Depends(get_db)):
    relationships = (
        db.query(models.FaultlineRelationship)
        .order_by(
            models.FaultlineRelationship.created_at.desc(),
            models.FaultlineRelationship.faultline_id.desc(),
        )
        .all()
    )
    return [serialize_faultline_case(db, item) for item in relationships]


@app.get("/faultline/{faultline_id}")
def get_faultline_case(
    faultline_id: int,
    db: Session = Depends(get_db),
):
    relationship = db.query(models.FaultlineRelationship).filter(
        models.FaultlineRelationship.faultline_id == faultline_id
    ).first()

    if not relationship:
        raise HTTPException(status_code=404, detail="Faultline case not found")

    return serialize_faultline_case(db, relationship)


@app.post("/faultline/{faultline_id}/classify")
def classify_faultline_case(
    faultline_id: int,
    payload: dict,
    current_user: models.User = Depends(require_authority_user),
    db: Session = Depends(get_db),
):
    relationship = db.query(models.FaultlineRelationship).filter(
        models.FaultlineRelationship.faultline_id == faultline_id
    ).first()

    if not relationship:
        raise HTTPException(status_code=404, detail="Faultline case not found")

    classification = str(payload.get("classification") or "").strip().lower()
    explanation = str(payload.get("explanation") or "").strip()

    if classification not in FAULTLINE_CLASSIFICATIONS:
        raise HTTPException(
            status_code=400,
            detail=(
                "Classification must be recurrence, unresolved_continuation, "
                "new_related_fault, unrelated or undetermined."
            ),
        )

    if not explanation:
        raise HTTPException(
            status_code=400,
            detail="Explain how the previous and current records are related.",
        )

    relationship.relationship_status = "classified"
    relationship.authority_classification = classification
    relationship.authority_explanation = explanation
    relationship.classified_by_user_id = current_user.user_id
    relationship.classified_at = datetime.utcnow()

    db.commit()
    db.refresh(relationship)

    event = {
        "event": "faultline_relationship_classified",
        "faultline_id": relationship.faultline_id,
        "classification": classification,
        "explanation": explanation,
        "related_complaint_id": relationship.previous_complaint_id,
    }
    append_integrity_event(relationship.new_complaint_id, event)

    append_integrity_event(
        relationship.previous_complaint_id,
        {
            **event,
            "related_complaint_id": relationship.new_complaint_id,
        },
    )

    return serialize_faultline_case(db, relationship)


@app.get("/complaints/{complaint_id}/resolution-attempts")
def get_resolution_attempts(
    complaint_id: int,
    db: Session = Depends(get_db)
):
    complaint = db.query(models.Complaint).filter(
        models.Complaint.complaint_id == complaint_id
    ).first()
    if not complaint:
        raise HTTPException(status_code=404, detail="Complaint not found")

    attempts = authority_attempts_for_complaint(db, complaint_id)
    return [
        serialize_authority_attempt(db, attempt, index + 1)
        for index, attempt in enumerate(attempts)
    ]


# =========================================================
# GENERIC RATING REVIEWS
# =========================================================

@app.post("/reviews")
def create_review(
    review: schemas.ReviewCreate,
    current_user: models.User = Depends(require_cityfile_user),
    db: Session = Depends(get_db)
):
    complaint = db.query(models.Complaint).filter(
        models.Complaint.complaint_id == review.complaint_id
    ).first()
    if not complaint:
        raise HTTPException(status_code=404, detail="Complaint not found")

    new_review = models.Review(
        complaint_id=review.complaint_id,
        user_id=current_user.user_id,
        rating=review.rating,
        comment=review.comment
    )

    db.add(new_review)
    db.commit()
    db.refresh(new_review)

    return new_review


@app.get("/complaints/{complaint_id}/reviews")
def get_reviews(
    complaint_id: int,
    db: Session = Depends(get_db)
):
    return db.query(models.Review).filter(
        models.Review.complaint_id == complaint_id
    ).all()


@app.get("/blockchain")
def get_blockchain():
    return {
        "type": "local_sha256_hash_chain",
        "is_public_blockchain": False,
        "valid": bool(blockchain.verify_chain()),
        "error": blockchain.integrity_error,
        "blocks": [
            {
                "index": block.index,
                "complaint_id": block.complaint_id,
                "timestamp": block.timestamp,
                "data": block.data,
                "previous_hash": block.previous_hash,
                "hash": block.hash
            }
            for block in blockchain.chain
        ]
    }


# =========================================================
# WEB3 STATUS
# =========================================================

@app.get("/web3/status")
def get_web3_status():
    if Web3 is None:
        return {
            "configured": False,
            "connected": False,
            "reason": "web3.py is not installed"
        }

    if not RPC_URL or not PRIVATE_KEY or not CONTRACT_ADDRESS:
        return {
            "configured": False,
            "connected": False,
            "reason": "Missing Web3 environment variables"
        }

    if web3 is None or contract is None or account is None:
        return {
            "configured": True,
            "connected": False,
            "reason": "Web3 failed to initialize"
        }

    try:
        connected = web3.is_connected()

        contract_code = b""
        if connected:
            contract_code = web3.eth.get_code(
                Web3.to_checksum_address(CONTRACT_ADDRESS)
            )

        return {
            "configured": True,
            "connected": connected,
            "chain_id": web3.eth.chain_id if connected else None,
            "latest_block": web3.eth.block_number if connected else None,
            "account_address": account.address,
            "contract_address": Web3.to_checksum_address(CONTRACT_ADDRESS),
            "contract_code_present": bool(
                contract_code and contract_code != b"\x00"
            )
        }

    except Exception as error:
        return {
            "configured": True,
            "connected": False,
            "reason": str(error)
        }

# =========================================================
# CITYKEEPERS - BACKEND-DRIVEN COMMUNITY ACTION
# =========================================================



# =========================================================
# CITYKEEPERS - BACKEND-DRIVEN COMMUNITY ACTION
# =========================================================

@app.get("/citykeepers/mission-stats")
def get_citykeeper_mission_stats(
    db: Session = Depends(get_db)
):
    """
    Public, non-identifying mission counts.
    Anonymous prototype rows are intentionally excluded.
    """

    participations = db.query(
        models.CitykeeperParticipation
    ).filter(
        models.CitykeeperParticipation.status ==
        "Joined",
        models.CitykeeperParticipation.user_id.isnot(
            None
        )
    ).all()

    evidence_records = db.query(
        models.Evidence
    ).filter(
        models.Evidence.evidence_type ==
        "citykeeper_after",
        models.Evidence.uploaded_by_user.isnot(
            None
        )
    ).all()

    verifications = db.query(
        models.CitykeeperVerification
    ).filter(
        models.CitykeeperVerification.decision ==
        "verified"
    ).all()

    stats = {}

    def ensure_record(complaint_id):
        key = int(complaint_id)

        if key not in stats:
            stats[key] = {
                "complaint_id": key,
                "participant_count": 0,
                "evidence_count": 0,
                "verified_count": 0
            }

        return stats[key]

    seen_participants = set()

    for participation in participations:
        pair = (
            participation.complaint_id,
            participation.user_id
        )

        if pair in seen_participants:
            continue

        seen_participants.add(pair)

        ensure_record(
            participation.complaint_id
        )["participant_count"] += 1

    evidence_by_id = {}

    for evidence in evidence_records:
        evidence_by_id[
            evidence.evidence_id
        ] = evidence

        ensure_record(
            evidence.complaint_id
        )["evidence_count"] += 1

    for verification in verifications:
        evidence = evidence_by_id.get(
            verification.evidence_id
        )

        if not evidence:
            continue

        ensure_record(
            evidence.complaint_id
        )["verified_count"] += 1

    return list(
        stats.values()
    )


@app.post("/citykeepers/{complaint_id}/join")
def join_citykeeper_mission(
    complaint_id: int,
    current_user: models.User = Depends(
        require_cityfile_user
    ),
    db: Session = Depends(get_db)
):
    complaint = db.query(
        models.Complaint
    ).filter(
        models.Complaint.complaint_id ==
        complaint_id
    ).first()

    if not complaint:
        raise HTTPException(
            status_code=404,
            detail="Complaint not found"
        )

    if not citykeeper_community_eligible(
        complaint
    ):
        raise HTTPException(
            status_code=400,
            detail=(
                "This complaint is not eligible "
                "for community-safe action."
            )
        )

    latest_evidence = latest_citykeeper_evidence(
        db,
        complaint_id
    )

    if latest_evidence:
        latest_verification = (
            citykeeper_verification_for_evidence(
                db,
                latest_evidence.evidence_id
            )
        )

        if not latest_verification:
            raise HTTPException(
                status_code=409,
                detail=(
                    "This community mission already "
                    "has evidence awaiting verification."
                )
            )

        if (
            latest_verification.decision ==
            "verified"
        ):
            raise HTTPException(
                status_code=409,
                detail=(
                    "This community mission already "
                    "has verified impact."
                )
            )

    existing_participation = db.query(
        models.CitykeeperParticipation
    ).filter(
        models.CitykeeperParticipation.complaint_id ==
        complaint_id,
        models.CitykeeperParticipation.user_id ==
        current_user.user_id,
        models.CitykeeperParticipation.status ==
        "Joined"
    ).first()

    if existing_participation:
        return {
            "participation_id":
                existing_participation.participation_id,
            "complaint_id":
                existing_participation.complaint_id,
            "user_id":
                existing_participation.user_id,
            "status":
                existing_participation.status,
            "joined_at":
                existing_participation.joined_at,
            "already_joined":
                True
        }

    participation = (
        models.CitykeeperParticipation(
            complaint_id=complaint_id,
            user_id=current_user.user_id,
            status="Joined"
        )
    )

    db.add(participation)
    db.commit()
    db.refresh(participation)

    return {
        "participation_id":
            participation.participation_id,
        "complaint_id":
            participation.complaint_id,
        "user_id":
            participation.user_id,
        "status":
            participation.status,
        "joined_at":
            participation.joined_at,
        "already_joined":
            False
    }


@app.get("/citykeepers/participations")
def get_citykeeper_participations(
    current_user: models.User = Depends(
        require_cityfile_user
    ),
    db: Session = Depends(get_db)
):
    participations = db.query(
        models.CitykeeperParticipation
    ).filter(
        models.CitykeeperParticipation.user_id ==
        current_user.user_id,
        models.CitykeeperParticipation.status ==
        "Joined"
    ).order_by(
        models.CitykeeperParticipation.joined_at.desc(),
        models.CitykeeperParticipation.participation_id.desc()
    ).all()

    return [
        {
            "participation_id":
                participation.participation_id,
            "complaint_id":
                participation.complaint_id,
            "user_id":
                participation.user_id,
            "status":
                participation.status,
            "joined_at":
                participation.joined_at
        }
        for participation in participations
    ]


@app.get("/citykeepers/{complaint_id}/evidence")
def get_citykeeper_evidence(
    complaint_id: int,
    db: Session = Depends(get_db)
):
    evidence = latest_citykeeper_evidence(
        db,
        complaint_id
    )

    if not evidence:
        return None

    contributor = None

    if evidence.uploaded_by_user:
        contributor = db.query(
            models.User
        ).filter(
            models.User.user_id ==
            evidence.uploaded_by_user
        ).first()

    return {
        "evidence_id":
            evidence.evidence_id,
        "complaint_id":
            evidence.complaint_id,
        "evidence_type":
            evidence.evidence_type,
        "file_url":
            evidence.file_url,
        "file_hash":
            evidence.file_hash,
        "description":
            evidence.description,
        "uploaded_by_user":
            evidence.uploaded_by_user,
        "contributor_public_id":
            (
                contributor.public_user_id
                if contributor
                else None
            ),
        "uploaded_at":
            evidence.uploaded_at
    }


@app.post(
    "/citykeepers/{complaint_id}/evidence/upload"
)
async def upload_citykeeper_evidence(
    complaint_id: int,
    file: UploadFile = File(...),
    description: str | None = Form(None),
    current_user: models.User = Depends(
        require_cityfile_user
    ),
    db: Session = Depends(get_db)
):
    complaint = db.query(
        models.Complaint
    ).filter(
        models.Complaint.complaint_id ==
        complaint_id
    ).first()

    if not complaint:
        raise HTTPException(
            status_code=404,
            detail="Complaint not found"
        )

    if not citykeeper_community_eligible(
        complaint
    ):
        raise HTTPException(
            status_code=400,
            detail=(
                "This complaint is not eligible "
                "for community-safe action."
            )
        )

    participation = db.query(
        models.CitykeeperParticipation
    ).filter(
        models.CitykeeperParticipation.complaint_id ==
        complaint_id,
        models.CitykeeperParticipation.user_id ==
        current_user.user_id,
        models.CitykeeperParticipation.status ==
        "Joined"
    ).first()

    if not participation:
        raise HTTPException(
            status_code=403,
            detail=(
                "Join this Citykeeper mission before "
                "submitting community evidence."
            )
        )

    latest_evidence = latest_citykeeper_evidence(
        db,
        complaint_id
    )

    if latest_evidence:
        latest_verification = (
            citykeeper_verification_for_evidence(
                db,
                latest_evidence.evidence_id
            )
        )

        # Pending evidence remains the active proof.
        if not latest_verification:
            raise HTTPException(
                status_code=409,
                detail=(
                    "Community evidence is already "
                    "awaiting citizen verification."
                )
            )

        # A verified mission is complete.
        if (
            latest_verification.decision ==
            "verified"
        ):
            raise HTTPException(
                status_code=409,
                detail=(
                    "This community mission already "
                    "has verified impact."
                )
            )

        # Rejected evidence can be followed by a new proof.
        if (
            latest_verification.decision !=
            "rejected"
        ):
            raise HTTPException(
                status_code=409,
                detail=(
                    "A community evidence decision "
                    "already exists."
                )
            )

    return await store_complaint_image_evidence(
        complaint_id=complaint_id,
        file=file,
        evidence_type="citykeeper_after",
        uploaded_by_user=current_user.user_id,
        uploaded_by_officer=None,
        description=description,
        db=db
    )


@app.post("/citykeepers/{complaint_id}/verify")
def verify_citykeeper_evidence(
    complaint_id: int,
    decision: str,
    current_user: models.User = Depends(
        require_cityfile_user
    ),
    db: Session = Depends(get_db)
):
    decision = decision.lower().strip()

    if decision not in {
        "verified",
        "rejected"
    }:
        raise HTTPException(
            status_code=400,
            detail=(
                "Decision must be 'verified' "
                "or 'rejected'."
            )
        )

    complaint = db.query(
        models.Complaint
    ).filter(
        models.Complaint.complaint_id ==
        complaint_id
    ).first()

    if not complaint:
        raise HTTPException(
            status_code=404,
            detail="Complaint not found"
        )

    evidence = latest_citykeeper_evidence(
        db,
        complaint_id
    )

    if not evidence:
        raise HTTPException(
            status_code=404,
            detail="No Citykeeper evidence found"
        )

    if (
        evidence.uploaded_by_user and
        evidence.uploaded_by_user ==
        current_user.user_id
    ):
        raise HTTPException(
            status_code=403,
            detail=(
                "A Citykeeper cannot verify their "
                "own community evidence."
            )
        )

    existing = (
        citykeeper_verification_for_evidence(
            db,
            evidence.evidence_id
        )
    )

    # Decisions are append-only per evidence item.
    # Once this proof has a verdict, do not silently overwrite it.
    if existing:
        return {
            **serialize_citykeeper_verification(
                existing
            ),
            "already_decided": True
        }

    verification = (
        models.CitykeeperVerification(
            evidence_id=evidence.evidence_id,
            complaint_id=complaint_id,
            verified_by_user=current_user.user_id,
            decision=decision
        )
    )

    db.add(verification)
    db.commit()
    db.refresh(verification)

    append_integrity_event(
        complaint_id,
        {
            "event": "citykeeper_evidence_reviewed",
            "evidence_id": evidence.evidence_id,
            "verification_id": verification.verification_id,
            "decision": decision
        }
    )

    return {
        **serialize_citykeeper_verification(
            verification
        ),
        "already_decided": False
    }


@app.get(
    "/citykeepers/{complaint_id}/verification"
)
def get_citykeeper_verification(
    complaint_id: int,
    db: Session = Depends(get_db)
):
    evidence = latest_citykeeper_evidence(
        db,
        complaint_id
    )

    if not evidence:
        return None

    verification = (
        citykeeper_verification_for_evidence(
            db,
            evidence.evidence_id
        )
    )

    return serialize_citykeeper_verification(
        verification
    )


@app.get("/citykeepers/me")
def get_citykeeper_profile(
    current_user: models.User = Depends(
        require_cityfile_user
    ),
    db: Session = Depends(get_db)
):
    participations = db.query(
        models.CitykeeperParticipation
    ).filter(
        models.CitykeeperParticipation.user_id ==
        current_user.user_id,
        models.CitykeeperParticipation.status ==
        "Joined"
    ).order_by(
        models.CitykeeperParticipation.joined_at.desc(),
        models.CitykeeperParticipation.participation_id.desc()
    ).all()

    own_evidence = db.query(
        models.Evidence
    ).filter(
        models.Evidence.evidence_type ==
        "citykeeper_after",
        models.Evidence.uploaded_by_user ==
        current_user.user_id
    ).order_by(
        models.Evidence.uploaded_at.desc(),
        models.Evidence.evidence_id.desc()
    ).all()

    own_evidence_by_complaint = {}

    for evidence in own_evidence:
        own_evidence_by_complaint.setdefault(
            evidence.complaint_id,
            evidence
        )

    verified_count = 0

    verified_evidence_ids = set()

    for evidence in own_evidence:
        verification = (
            citykeeper_verification_for_evidence(
                db,
                evidence.evidence_id
            )
        )

        if (
            verification and
            verification.decision ==
            "verified"
        ):
            verified_count += 1
            verified_evidence_ids.add(
                evidence.evidence_id
            )

    trail = []

    for participation in participations:
        evidence = own_evidence_by_complaint.get(
            participation.complaint_id
        )

        verification = None

        if evidence:
            verification = (
                citykeeper_verification_for_evidence(
                    db,
                    evidence.evidence_id
                )
            )

        if (
            verification and
            verification.decision ==
            "verified"
        ):
            status_label = "VERIFIED IMPACT"
            status_class = "verified"
            status_time = (
                verification.created_at or
                evidence.uploaded_at
            )
        elif (
            verification and
            verification.decision ==
            "rejected"
        ):
            status_label = "NEW PROOF NEEDED"
            status_class = "evidence"
            status_time = (
                verification.created_at or
                evidence.uploaded_at
            )
        elif evidence:
            status_label = (
                "AWAITING CITIZEN VERIFICATION"
            )
            status_class = "evidence"
            status_time = evidence.uploaded_at
        else:
            status_label = "MISSION JOINED"
            status_class = "joined"
            status_time = participation.joined_at

        trail.append({
            "complaint_id":
                participation.complaint_id,
            "participation_id":
                participation.participation_id,
            "joined_at":
                participation.joined_at,
            "evidence_id":
                evidence.evidence_id
                if evidence
                else None,
            "evidence_submitted_at":
                evidence.uploaded_at
                if evidence
                else None,
            "verification_decision":
                verification.decision
                if verification
                else None,
            "verification_created_at":
                verification.created_at
                if verification
                else None,
            "status_label":
                status_label,
            "status_class":
                status_class,
            "status_time":
                status_time
        })

    trail.sort(
        key=lambda item: (
            item["status_time"] or
            datetime.min
        ),
        reverse=True
    )

    evidence_count = len(
        own_evidence
    )

    impact_percent = (
        round(
            (
                verified_count /
                evidence_count
            ) * 100
        )
        if evidence_count
        else 0
    )

    return {
        "user": {
            "user_id":
                current_user.user_id,
            "public_user_id":
                current_user.public_user_id
        },
        "stats": {
            "joined":
                len(participations),
            "evidence":
                evidence_count,
            "verified":
                verified_count,
            "impact_percent":
                impact_percent
        },
        "trail":
            trail
    }


@app.get("/citykeepers/leaderboard")
def get_citykeeper_leaderboard(
    period: str = "month",
    db: Session = Depends(get_db)
):
    period = period.lower().strip()

    if period not in {
        "month",
        "all"
    }:
        raise HTTPException(
            status_code=400,
            detail=(
                "Period must be 'month' or 'all'."
            )
        )

    month_start = None

    if period == "month":
        now = datetime.utcnow()
        month_start = datetime(
            now.year,
            now.month,
            1
        )

    verifications = db.query(
        models.CitykeeperVerification
    ).filter(
        models.CitykeeperVerification.decision ==
        "verified"
    ).all()

    verified_counts = {}

    for verification in verifications:
        if (
            month_start is not None and
            verification.created_at and
            verification.created_at <
            month_start
        ):
            continue

        evidence = db.query(
            models.Evidence
        ).filter(
            models.Evidence.evidence_id ==
            verification.evidence_id,
            models.Evidence.evidence_type ==
            "citykeeper_after"
        ).first()

        if (
            not evidence or
            not evidence.uploaded_by_user
        ):
            continue

        verified_counts[
            evidence.uploaded_by_user
        ] = (
            verified_counts.get(
                evidence.uploaded_by_user,
                0
            ) + 1
        )

    entries = []

    for user_id, verified in (
        verified_counts.items()
    ):
        user = db.query(
            models.User
        ).filter(
            models.User.user_id ==
            user_id
        ).first()

        if not user:
            continue

        evidence_count = db.query(
            models.Evidence
        ).filter(
            models.Evidence.evidence_type ==
            "citykeeper_after",
            models.Evidence.uploaded_by_user ==
            user_id
        ).count()

        joined_count = db.query(
            models.CitykeeperParticipation
        ).filter(
            models.CitykeeperParticipation.user_id ==
            user_id,
            models.CitykeeperParticipation.status ==
            "Joined"
        ).count()

        entries.append({
            "public_user_id":
                (
                    user.public_user_id or
                    f"CK-{user.user_id:06d}"
                ),
            "verified":
                verified,
            "evidence":
                evidence_count,
            "joined":
                joined_count
        })

    entries.sort(
        key=lambda item: (
            -item["verified"],
            -item["evidence"],
            -item["joined"],
            item["public_user_id"]
        )
    )

    return {
        "period": period,
        "entries": entries[:10]
    }

