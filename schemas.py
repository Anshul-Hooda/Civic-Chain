from pydantic import BaseModel
from typing import Optional
from datetime import datetime


# =========================
# USER
# =========================

class UserCreate(BaseModel):
    name: str
    email: str
    phone: Optional[str] = None
    public_user_id: Optional[str] = None


# =========================
# COMPLAINT
# =========================

class ComplaintCreate(BaseModel):
    user_id: Optional[int] = None
    city_id: Optional[int] = None
    category_id: Optional[int] = None
    department_id: Optional[int] = None

    description: str
    location: str

    priority: Optional[str] = "Medium"
    deadline: Optional[datetime] = None


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
    file_url: str
    file_hash: Optional[str] = None
    description: Optional[str] = None


# =========================
# REVIEW
# =========================

class ReviewCreate(BaseModel):
    complaint_id: int
    user_id: int
    rating: int
    comment: Optional[str] = None