from fastapi import FastAPI

from fastapi.middleware.cors import CORSMiddleware
from fastapi import FastAPI, Depends, HTTPException
from sqlalchemy.orm import Session
from blockchain import blockchain
from fastapi.responses import FileResponse
from fastapi.staticfiles import StaticFiles

import models
import schemas

from database import get_db, engine

models.Base.metadata.create_all(bind=engine)
from database import SessionLocal

db = SessionLocal()

if db.query(models.City).count() == 0:
    db.add_all([
        models.City(city_name="Delhi"),
        models.City(city_name="Sonipat"),
        models.City(city_name="Gurugram")
    ])

if db.query(models.Category).count() == 0:
    db.add_all([
        models.Category(category_name="Pothole"),
        models.Category(category_name="Broken Streetlight"),
        models.Category(category_name="Water Leakage"),
        models.Category(category_name="Overflowing Garbage"),
        models.Category(category_name="Unsafe Road"),
        models.Category(category_name="Drainage Problem")
    ])

db.commit()

if db.query(models.Department).count() == 0:
    delhi = db.query(models.City).filter(
        models.City.city_name == "Delhi"
    ).first()

    db.add_all([
        models.Department(
            department_name="Roads",
            city_id=delhi.city_id
        ),
        models.Department(
            department_name="Sanitation",
            city_id=delhi.city_id
        ),
        models.Department(
            department_name="Water Supply",
            city_id=delhi.city_id
        ),
        models.Department(
            department_name="Electricity",
            city_id=delhi.city_id
        ),
        models.Department(
            department_name="Police",
            city_id=delhi.city_id
        )
    ])

    db.commit()

db.close()


app = FastAPI(
    title="Civic Complaints API",
    description="Backend API for Civic Complaint Management System",
    version="1.0"
)
app.mount("/assets", StaticFiles(directory="assets"), name="assets")


@app.get("/deployment-test")
def deployment_test():
    return {"version": "CITYFILES-ASSETS-FIX-1"}

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)





# =========================================================
# HOME / TEST
# =========================================================

@app.get("/")
def home(): 
    return FileResponse("index.html")

@app.get("/style.css")
def style():
    return FileResponse("style.css", media_type="text/css")


@app.get("/script.js")
def script():
    return FileResponse("script.js", media_type="application/javascript")


# =========================================================
# USERS
# =========================================================

@app.post("/users")
def create_user(
    user: schemas.UserCreate,
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
def get_users(db: Session = Depends(get_db)):
    return db.query(models.User).all()


@app.get("/users/{user_id}")
def get_user(
    user_id: int,
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

@app.post("/complaints")
def create_complaint(
    complaint: schemas.ComplaintCreate,
    db: Session = Depends(get_db)
):
    new_complaint = models.Complaint(
        user_id=complaint.user_id,
        city_id=complaint.city_id,
        category_id=complaint.category_id,
        department_id=complaint.department_id,
        description=complaint.description,
        location=complaint.location,
        priority=complaint.priority,
        status="Submitted",
        deadline=complaint.deadline
    )

    db.add(new_complaint)
    db.commit()
    db.refresh(new_complaint)

    # Add complaint to CivicChain blockchain
    block = blockchain.add_complaint(
        new_complaint.complaint_id,
        {
            "description": new_complaint.description,
            "location": new_complaint.location,
            "priority": new_complaint.priority,
            "status": new_complaint.status
        }
    )

    return {
        "complaint_id": new_complaint.complaint_id,
        "user_id": new_complaint.user_id,
        "city_id": new_complaint.city_id,
        "category_id": new_complaint.category_id,
        "department_id": new_complaint.department_id,
        "description": new_complaint.description,
        "location": new_complaint.location,
        "priority": new_complaint.priority,
        "status": new_complaint.status,
        "blockchain_hash": block.hash,
        "block_index": block.index
    }


@app.get("/complaints")
def get_complaints(db: Session = Depends(get_db)):
    return db.query(models.Complaint).all()


@app.get("/complaints/{complaint_id}")
def get_complaint(
    complaint_id: int,
    db: Session = Depends(get_db)
):
    complaint = db.query(models.Complaint).filter(
        models.Complaint.complaint_id == complaint_id
    ).first()

    if not complaint:
        raise HTTPException(
            status_code=404,
            detail="Complaint not found"
        )

    return complaint


@app.put("/complaints/{complaint_id}")
def update_complaint(
    complaint_id: int,
    data: schemas.ComplaintUpdateSchema,
    db: Session = Depends(get_db)
):
    complaint = db.query(models.Complaint).filter(
        models.Complaint.complaint_id == complaint_id
    ).first()

    if not complaint:
        raise HTTPException(
            status_code=404,
            detail="Complaint not found"
        )

    if data.status is not None:
        complaint.status = data.status

    if data.priority is not None:
        complaint.priority = data.priority

    if data.deadline is not None:
        complaint.deadline = data.deadline

    db.commit()
    db.refresh(complaint)

    return complaint


# =========================================================
# COMPLAINT ASSIGNMENTS
# =========================================================

@app.post("/assignments")
def assign_complaint(
    assignment: schemas.AssignmentCreate,
    db: Session = Depends(get_db)
):
    new_assignment = models.ComplaintAssignment(
        complaint_id=assignment.complaint_id,
        officer_id=assignment.officer_id
    )

    db.add(new_assignment)
    db.commit()
    db.refresh(new_assignment)

    return new_assignment


@app.get("/assignments")
def get_assignments(db: Session = Depends(get_db)):
    return db.query(
        models.ComplaintAssignment
    ).all()


# =========================================================
# COMPLAINT UPDATES
# =========================================================

@app.post("/complaint-updates")
def create_complaint_update(
    update: schemas.ComplaintUpdateCreate,
    db: Session = Depends(get_db)
):
    complaint = db.query(models.Complaint).filter(
        models.Complaint.complaint_id == update.complaint_id
    ).first()

    if not complaint:
        raise HTTPException(
            status_code=404,
            detail="Complaint not found"
        )

    new_update = models.ComplaintUpdate(
        complaint_id=update.complaint_id,
        officer_id=update.officer_id,
        status=update.status,
        comment=update.comment
    )

    complaint.status = update.status

    db.add(new_update)
    db.commit()
    db.refresh(new_update)

    return new_update


@app.get("/complaints/{complaint_id}/updates")
def get_complaint_updates(
    complaint_id: int,
    db: Session = Depends(get_db)
):
    return db.query(
        models.ComplaintUpdate
    ).filter(
        models.ComplaintUpdate.complaint_id == complaint_id
    ).all()


# =========================================================
# EVIDENCE
# =========================================================

@app.post("/evidence")
def add_evidence(
    evidence: schemas.EvidenceCreate,
    db: Session = Depends(get_db)
):
    new_evidence = models.Evidence(
        complaint_id=evidence.complaint_id,
        uploaded_by_officer=evidence.uploaded_by_officer,
        file_url=evidence.file_url,
        file_hash=evidence.file_hash,
        description=evidence.description
    )

    db.add(new_evidence)
    db.commit()
    db.refresh(new_evidence)

    return new_evidence


@app.get("/complaints/{complaint_id}/evidence")
def get_evidence(
    complaint_id: int,
    db: Session = Depends(get_db)
):
    return db.query(
        models.Evidence
    ).filter(
        models.Evidence.complaint_id == complaint_id
    ).all()


# =========================================================
# REVIEWS
# =========================================================

@app.post("/reviews")
def create_review(
    review: schemas.ReviewCreate,
    db: Session = Depends(get_db)
):
    new_review = models.Review(
        complaint_id=review.complaint_id,
        user_id=review.user_id,
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
    return db.query(
        models.Review
    ).filter(
        models.Review.complaint_id == complaint_id
    ).all()

@app.get("/blockchain")
def get_blockchain():
    return [
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