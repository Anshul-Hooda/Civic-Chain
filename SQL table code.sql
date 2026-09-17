CREATE DATABASE IF NOT EXISTS civic_complaints;
USE civic_complaints;


-- 1. USERS
CREATE TABLE users (
    user_id INT AUTO_INCREMENT PRIMARY KEY,
    name VARCHAR(100),
    email VARCHAR(150) UNIQUE,
    phone VARCHAR(20),
    public_user_id VARCHAR(50) UNIQUE,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);


-- 2. CITIES
CREATE TABLE cities (
    city_id INT AUTO_INCREMENT PRIMARY KEY,
    city_name VARCHAR(100) NOT NULL
);


-- 3. CATEGORIES
CREATE TABLE categories (
    category_id INT AUTO_INCREMENT PRIMARY KEY,
    category_name VARCHAR(100) NOT NULL
);


-- 4. DEPARTMENTS
CREATE TABLE departments (
    department_id INT AUTO_INCREMENT PRIMARY KEY,
    department_name VARCHAR(150) NOT NULL,
    city_id INT,
    contact_email VARCHAR(150),

    FOREIGN KEY (city_id)
        REFERENCES cities(city_id)
);


-- 5. OFFICERS
CREATE TABLE officers (
    officer_id INT AUTO_INCREMENT PRIMARY KEY,
    officer_name VARCHAR(100) NOT NULL,
    role VARCHAR(100),
    department_id INT,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,

    FOREIGN KEY (department_id)
        REFERENCES departments(department_id)
);


-- 6. COMPLAINTS
CREATE TABLE complaints (
    complaint_id INT AUTO_INCREMENT PRIMARY KEY,
    user_id INT,
    city_id INT,
    category_id INT,
    department_id INT,

    description TEXT,
    location VARCHAR(255),

    priority VARCHAR(20) DEFAULT 'Medium',
    status VARCHAR(30) DEFAULT 'Submitted',

    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    deadline DATETIME,

    FOREIGN KEY (user_id)
        REFERENCES users(user_id),

    FOREIGN KEY (city_id)
        REFERENCES cities(city_id),

    FOREIGN KEY (category_id)
        REFERENCES categories(category_id),

    FOREIGN KEY (department_id)
        REFERENCES departments(department_id)
);


-- 7. COMPLAINT ASSIGNMENTS
CREATE TABLE complaint_assignments (
    assignment_id INT AUTO_INCREMENT PRIMARY KEY,
    complaint_id INT NOT NULL,
    officer_id INT NOT NULL,

    assigned_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    status VARCHAR(30) DEFAULT 'Active',

    FOREIGN KEY (complaint_id)
        REFERENCES complaints(complaint_id),

    FOREIGN KEY (officer_id)
        REFERENCES officers(officer_id)
);


-- 8. COMPLAINT UPDATES
CREATE TABLE complaint_updates (
    update_id INT AUTO_INCREMENT PRIMARY KEY,
    complaint_id INT NOT NULL,
    officer_id INT,

    status VARCHAR(30),
    comment TEXT,

    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,

    FOREIGN KEY (complaint_id)
        REFERENCES complaints(complaint_id),

    FOREIGN KEY (officer_id)
        REFERENCES officers(officer_id)
);


-- 9. EVIDENCE
CREATE TABLE evidence (
    evidence_id INT AUTO_INCREMENT PRIMARY KEY,
    complaint_id INT NOT NULL,

    uploaded_by_officer INT,
    file_url VARCHAR(500),
    file_hash VARCHAR(255),
    description TEXT,

    uploaded_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,

    FOREIGN KEY (complaint_id)
        REFERENCES complaints(complaint_id),

    FOREIGN KEY (uploaded_by_officer)
        REFERENCES officers(officer_id)
);


-- 10. REVIEWS
CREATE TABLE reviews (
    review_id INT AUTO_INCREMENT PRIMARY KEY,
    complaint_id INT NOT NULL,
    user_id INT NOT NULL,

    rating INT,
    comment TEXT,

    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,

    FOREIGN KEY (complaint_id)
        REFERENCES complaints(complaint_id),

    FOREIGN KEY (user_id)
        REFERENCES users(user_id)
);
