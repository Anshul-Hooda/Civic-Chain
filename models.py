from sqlalchemy import Column, Integer, String, Text, DateTime, ForeignKey
from sqlalchemy.sql import func
from sqlalchemy.orm import relationship

from database import Base


# =========================================================
# 1. USERS
# =========================================================

class User(Base):
    __tablename__ = "users"

    user_id = Column(Integer, primary_key=True, index=True)
    name = Column(String(100))
    email = Column(String(150), unique=True)
    phone = Column(String(20))
    public_user_id = Column(String(50), unique=True)
    created_at = Column(DateTime, server_default=func.now())

    complaints = relationship("Complaint", back_populates="user")
    reviews = relationship("Review", back_populates="user")


# =========================================================
# 2. CITIES
# =========================================================

class City(Base):
    __tablename__ = "cities"

    city_id = Column(Integer, primary_key=True, index=True)
    city_name = Column(String(100), nullable=False)

    departments = relationship("Department", back_populates="city")
    complaints = relationship("Complaint", back_populates="city")


# =========================================================
# 3. CATEGORIES
# =========================================================

class Category(Base):
    __tablename__ = "categories"

    category_id = Column(Integer, primary_key=True, index=True)
    category_name = Column(String(100), nullable=False)

    complaints = relationship("Complaint", back_populates="category")


# =========================================================
# 4. DEPARTMENTS
# =========================================================

class Department(Base):
    __tablename__ = "departments"

    department_id = Column(Integer, primary_key=True, index=True)
    department_name = Column(String(150), nullable=False)
    city_id = Column(Integer, ForeignKey("cities.city_id"))
    contact_email = Column(String(150))

    city = relationship("City", back_populates="departments")
    officers = relationship("Officer", back_populates="department")
    complaints = relationship("Complaint", back_populates="department")


# =========================================================
# 5. OFFICERS
# =========================================================

class Officer(Base):
    __tablename__ = "officers"

    officer_id = Column(Integer, primary_key=True, index=True)
    officer_name = Column(String(100), nullable=False)
    role = Column(String(100))
    department_id = Column(
        Integer,
        ForeignKey("departments.department_id")
    )
    created_at = Column(DateTime, server_default=func.now())

    department = relationship("Department", back_populates="officers")

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

    complaint_id = Column(Integer, primary_key=True, index=True)

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
    location = Column(String(255))

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

    deadline = Column(DateTime)

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

    status = Column(String(30))
    comment = Column(Text)

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

    file_url = Column(String(500))
    file_hash = Column(String(255))
    description = Column(Text)

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

    rating = Column(Integer)
    comment = Column(Text)

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