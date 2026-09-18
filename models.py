from sqlalchemy import (
    Column,
    Integer,
    String,
    Text,
    DateTime,
    ForeignKey,
    Float
)
from sqlalchemy.sql import func
from sqlalchemy.orm import relationship

from database import Base


# =========================================================
# 1. USERS
# =========================================================

class User(Base):
    __tablename__ = "users"

    user_id = Column(
        Integer,
        primary_key=True,
        index=True
    )

    name = Column(String(100))

    email = Column(
        String(150),
        unique=True
    )

    phone = Column(String(20))

    public_user_id = Column(
        String(50),
        unique=True
    )

    # Clerk identity for authenticated CITYKEEPERS actions.
    # Nullable keeps existing citizen/user records compatible.
    clerk_user_id = Column(
        String(255),
        unique=True,
        nullable=True,
        index=True
    )

    created_at = Column(
        DateTime,
        server_default=func.now()
    )

    complaints = relationship(
        "Complaint",
        back_populates="user"
    )

    reviews = relationship(
        "Review",
        back_populates="user"
    )


# =========================================================
# 2. CITIES
# =========================================================

class City(Base):
    __tablename__ = "cities"

    city_id = Column(
        Integer,
        primary_key=True,
        index=True
    )

    city_name = Column(
        String(100),
        nullable=False
    )

    departments = relationship(
        "Department",
        back_populates="city"
    )

    complaints = relationship(
        "Complaint",
        back_populates="city"
    )


# =========================================================
# 3. CATEGORIES
# =========================================================

class Category(Base):
    __tablename__ = "categories"

    category_id = Column(
        Integer,
        primary_key=True,
        index=True
    )

    category_name = Column(
        String(100),
        nullable=False
    )

    complaints = relationship(
        "Complaint",
        back_populates="category"
    )


# =========================================================
# 4. DEPARTMENTS
# =========================================================

class Department(Base):
    __tablename__ = "departments"

    department_id = Column(
        Integer,
        primary_key=True,
        index=True
    )

    department_name = Column(
        String(150),
        nullable=False
    )

    city_id = Column(
        Integer,
        ForeignKey("cities.city_id")
    )

    contact_email = Column(
        String(150)
    )

    city = relationship(
        "City",
        back_populates="departments"
    )

    officers = relationship(
        "Officer",
        back_populates="department"
    )

    complaints = relationship(
        "Complaint",
        back_populates="department"
    )


# =========================================================
# 5. OFFICERS
# =========================================================

class Officer(Base):
    __tablename__ = "officers"

    officer_id = Column(
        Integer,
        primary_key=True,
        index=True
    )

    officer_name = Column(
        String(100),
        nullable=False
    )

    role = Column(
        String(100)
    )

    department_id = Column(
        Integer,
        ForeignKey("departments.department_id")
    )

    created_at = Column(
        DateTime,
        server_default=func.now()
    )

    department = relationship(
        "Department",
        back_populates="officers"
    )

    assignments = relationship(
        "ComplaintAssignment",
        back_populates="officer"
    )

    updates = relationship(
        "ComplaintUpdate",
        back_populates="officer"
    )

    evidence = relationship(
        "Evidence",
        back_populates="officer"
    )


# =========================================================
# 6. COMPLAINTS
# =========================================================

class Complaint(Base):
    __tablename__ = "complaints"

    complaint_id = Column(
        Integer,
        primary_key=True,
        index=True
    )

    user_id = Column(
        Integer,
        ForeignKey("users.user_id")
    )

    city_id = Column(
        Integer,
        ForeignKey("cities.city_id")
    )

    category_id = Column(
        Integer,
        ForeignKey("categories.category_id")
    )

    department_id = Column(
        Integer,
        ForeignKey("departments.department_id")
    )

    description = Column(Text)

    location = Column(
        String(255)
    )

    priority = Column(
        String(20),
        default="Medium"
    )

    status = Column(
        String(30),
        default="Submitted"
    )

    created_at = Column(
        DateTime,
        server_default=func.now()
    )

    deadline = Column(
        DateTime
    )

    user = relationship(
        "User",
        back_populates="complaints"
    )

    city = relationship(
        "City",
        back_populates="complaints"
    )

    category = relationship(
        "Category",
        back_populates="complaints"
    )

    department = relationship(
        "Department",
        back_populates="complaints"
    )

    assignments = relationship(
        "ComplaintAssignment",
        back_populates="complaint"
    )

    updates = relationship(
        "ComplaintUpdate",
        back_populates="complaint"
    )

    evidence = relationship(
        "Evidence",
        back_populates="complaint"
    )

    reviews = relationship(
        "Review",
        back_populates="complaint"
    )


# =========================================================
# 7. COMPLAINT ASSIGNMENTS
# =========================================================

class ComplaintAssignment(Base):
    __tablename__ = "complaint_assignments"

    assignment_id = Column(
        Integer,
        primary_key=True,
        index=True
    )

    complaint_id = Column(
        Integer,
        ForeignKey("complaints.complaint_id"),
        nullable=False
    )

    officer_id = Column(
        Integer,
        ForeignKey("officers.officer_id"),
        nullable=False
    )

    assigned_at = Column(
        DateTime,
        server_default=func.now()
    )

    status = Column(
        String(30),
        default="Active"
    )

    complaint = relationship(
        "Complaint",
        back_populates="assignments"
    )

    officer = relationship(
        "Officer",
        back_populates="assignments"
    )


# =========================================================
# 8. COMPLAINT UPDATES
# =========================================================

class ComplaintUpdate(Base):
    __tablename__ = "complaint_updates"

    update_id = Column(
        Integer,
        primary_key=True,
        index=True
    )

    complaint_id = Column(
        Integer,
        ForeignKey("complaints.complaint_id"),
        nullable=False
    )

    officer_id = Column(
        Integer,
        ForeignKey("officers.officer_id")
    )

    status = Column(
        String(30)
    )

    comment = Column(
        Text
    )

    updated_at = Column(
        DateTime,
        server_default=func.now()
    )

    complaint = relationship(
        "Complaint",
        back_populates="updates"
    )

    officer = relationship(
        "Officer",
        back_populates="updates"
    )


# =========================================================
# 9. EVIDENCE
# =========================================================

class Evidence(Base):
    __tablename__ = "evidence"

    evidence_id = Column(
        Integer,
        primary_key=True,
        index=True
    )

    complaint_id = Column(
        Integer,
        ForeignKey("complaints.complaint_id"),
        nullable=False
    )

    uploaded_by_officer = Column(
        Integer,
        ForeignKey("officers.officer_id")
    )

    uploaded_by_user = Column(
        Integer,
        ForeignKey("users.user_id")
    )

    evidence_type = Column(
        String(50),
        default="citizen_report"
    )

    file_url = Column(
        String(500)
    )

    file_hash = Column(
        String(255)
    )

    description = Column(
        Text
    )

    uploaded_at = Column(
        DateTime,
        server_default=func.now()
    )

    complaint = relationship(
        "Complaint",
        back_populates="evidence"
    )

    officer = relationship(
        "Officer",
        back_populates="evidence"
    )


# =========================================================
# 10. REVIEWS
# =========================================================

class Review(Base):
    __tablename__ = "reviews"

    review_id = Column(
        Integer,
        primary_key=True,
        index=True
    )

    complaint_id = Column(
        Integer,
        ForeignKey("complaints.complaint_id"),
        nullable=False
    )

    user_id = Column(
        Integer,
        ForeignKey("users.user_id"),
        nullable=False
    )

    rating = Column(
        Integer
    )

    comment = Column(
        Text
    )

    created_at = Column(
        DateTime,
        server_default=func.now()
    )

    complaint = relationship(
        "Complaint",
        back_populates="reviews"
    )

    user = relationship(
        "User",
        back_populates="reviews"
    )


# =========================================================
# 11. CITYKEEPER PARTICIPATIONS
# =========================================================

class CitykeeperParticipation(Base):
    __tablename__ = "citykeeper_participations"

    participation_id = Column(
        Integer,
        primary_key=True,
        index=True
    )

    complaint_id = Column(
        Integer,
        ForeignKey("complaints.complaint_id"),
        nullable=False
    )

    user_id = Column(
        Integer,
        ForeignKey("users.user_id"),
        nullable=True
    )

    joined_at = Column(
        DateTime,
        server_default=func.now()
    )

    status = Column(
        String(30),
        default="Joined"
    )

    complaint = relationship(
        "Complaint"
    )

    user = relationship(
        "User"
    )


# =========================================================
# 12. CITYKEEPER VERIFICATIONS
# =========================================================

class CitykeeperVerification(Base):
    __tablename__ = "citykeeper_verifications"

    verification_id = Column(
        Integer,
        primary_key=True,
        index=True
    )

    evidence_id = Column(
        Integer,
        ForeignKey("evidence.evidence_id"),
        nullable=False
    )

    complaint_id = Column(
        Integer,
        ForeignKey("complaints.complaint_id"),
        nullable=False
    )

    verified_by_user = Column(
        Integer,
        ForeignKey("users.user_id"),
        nullable=True
    )

    decision = Column(
        String(20),
        nullable=False
    )

    created_at = Column(
        DateTime,
        server_default=func.now()
    )

    evidence = relationship(
        "Evidence"
    )

    complaint = relationship(
        "Complaint"
    )

    user = relationship(
        "User"
    )

# =========================================================
# 13. PRIVATE COMPLAINT REPORTER CONTACT
# =========================================================

class ComplaintReporter(Base):
    __tablename__ = "complaint_reporters"

    reporter_id = Column(Integer, primary_key=True, index=True)
    complaint_id = Column(
        Integer,
        ForeignKey("complaints.complaint_id"),
        nullable=False,
        unique=True,
        index=True
    )
    name = Column(String(100))
    email = Column(String(150))
    phone = Column(String(30))
    public_user_id = Column(String(100))
    created_at = Column(DateTime, server_default=func.now())

    complaint = relationship("Complaint")


# =========================================================
# 14. AUTHORITY RESOLUTION ATTEMPTS
# =========================================================

class AuthorityResolutionAttempt(Base):
    __tablename__ = "authority_resolution_attempts"

    attempt_id = Column(Integer, primary_key=True, index=True)
    complaint_id = Column(
        Integer,
        ForeignKey("complaints.complaint_id"),
        nullable=False,
        index=True
    )
    submitted_by_user_id = Column(
        Integer,
        ForeignKey("users.user_id"),
        nullable=True,
        index=True
    )
    authority_label = Column(String(160), nullable=False)
    note = Column(Text, nullable=False)
    file_url = Column(String(500), nullable=False)
    file_hash = Column(String(255), nullable=False)
    latitude = Column(Float)
    longitude = Column(Float)
    accuracy_m = Column(Float)
    captured_at = Column(DateTime)
    created_at = Column(DateTime, server_default=func.now())

    complaint = relationship("Complaint")
    submitted_by = relationship("User", foreign_keys=[submitted_by_user_id])


# =========================================================
# 15. CITIZEN RESOLUTION REVIEWS
# =========================================================

class CitizenResolutionReview(Base):
    __tablename__ = "citizen_resolution_reviews"

    resolution_review_id = Column(Integer, primary_key=True, index=True)
    complaint_id = Column(
        Integer,
        ForeignKey("complaints.complaint_id"),
        nullable=False,
        index=True
    )
    attempt_id = Column(
        Integer,
        ForeignKey("authority_resolution_attempts.attempt_id"),
        nullable=False,
        unique=True,
        index=True
    )
    verified_by_user = Column(
        Integer,
        ForeignKey("users.user_id"),
        nullable=False,
        index=True
    )
    decision = Column(String(20), nullable=False)
    reason = Column(Text)
    created_at = Column(DateTime, server_default=func.now())

    complaint = relationship("Complaint")
    attempt = relationship("AuthorityResolutionAttempt")
    user = relationship("User", foreign_keys=[verified_by_user])
