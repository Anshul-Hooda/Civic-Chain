from datetime import datetime
from typing import Optional

from pydantic import BaseModel, Field


# =========================
# USER
# =========================

class UserCreate(BaseModel):
    name: Optional[str] = None
    email: Optional[str] = None
    phone: Optional[str] = None
    public_user_id: Optional[str] = None


# =========================
# COMPLAINT
# =========================

class ComplaintCreate(BaseModel):
    # user_id is retained only for backwards compatibility. The backend does
    # not trust it for ownership; a valid Clerk session determines user_id.
    user_id: Optional[int] = None

    city_id: Optional[int] = None
    category_id: Optional[int] = None
    department_id: Optional[int] = None

    description: str
    location: str

    priority: Optional[str] = "Medium"
    deadline: Optional[datetime] = None

    # Private reporter metadata. This is stored separately from the public
    # complaint record and is never returned by the public complaint API.
    reporter_name: Optional[str] = None
    reporter_email: Optional[str] = None
    reporter_phone: Optional[str] = None
    reporter_public_user_id: Optional[str] = None


class ComplaintUpdateSchema(BaseModel):
    status: Optional[str] = None
    priority: Optional[str] = None
    deadline: Optional[datetime] = None


# =========================
# COMPLAINT ASSIGNMENT
# =========================

class AssignmentCreate(BaseModel):
    complaint_id: int
    officer_id: int


# =========================
# COMPLAINT UPDATE
# =========================

class ComplaintUpdateCreate(BaseModel):
    complaint_id: int
    officer_id: Optional[int] = None
    status: str
    comment: Optional[str] = None


# =========================
# EVIDENCE
# =========================

class EvidenceCreate(BaseModel):
    complaint_id: int
    uploaded_by_officer: Optional[int] = None
    uploaded_by_user: Optional[int] = None

    evidence_type: Optional[str] = "citizen_report"

    file_url: str
    file_hash: Optional[str] = None
    description: Optional[str] = None


# =========================
# REVIEW
# =========================

class ReviewCreate(BaseModel):
    complaint_id: int
    # Retained for backwards compatibility. Authenticated user identity wins.
    user_id: Optional[int] = None
    rating: int = Field(ge=1, le=5)
    comment: Optional[str] = None


# =========================
# AUTHORITY RESOLUTION REVIEW
# =========================

class ResolutionReviewCreate(BaseModel):
    decision: str
    reason: Optional[str] = None
