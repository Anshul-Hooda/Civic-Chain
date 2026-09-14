const API_BASE_URL = "http://127.0.0.1:8000";


// =====================================================
// SHOW COMPLAINT FORM
// =====================================================

function showComplaintForm() {
    document.getElementById("report").scrollIntoView({
        behavior: "smooth"
    });
}


// =====================================================
// CUSTOM OPTION HANDLER
// =====================================================

function checkCustomOption(selectId, inputId) {

    const select = document.getElementById(selectId);
    const input = document.getElementById(inputId);

    if (select.value === "other") {

        input.style.display = "block";
        input.required = true;
        input.focus();

    } else {

        input.style.display = "none";
        input.value = "";
        input.required = false;
    }
}


// =====================================================
// GET CURRENT LOCATION
// =====================================================

function getLocation() {

    const locationInput =
        document.getElementById("location");

    const locationMessage =
        document.getElementById("locationMessage");

    if (!navigator.geolocation) {

        locationMessage.textContent =
            "Location services are not supported by this browser.";

        locationMessage.style.color = "red";

        return;
    }

    locationMessage.textContent =
        "Getting your location...";

    locationMessage.style.color = "#555";


    navigator.geolocation.getCurrentPosition(

        function(position) {

            const latitude =
                position.coords.latitude;

            const longitude =
                position.coords.longitude;


            locationInput.value =
                "Latitude: " +
                latitude.toFixed(6) +
                ", Longitude: " +
                longitude.toFixed(6);


            locationMessage.textContent =
                "✓ Current location added.";

            locationMessage.style.color = "green";
        },


        function(error) {

            locationMessage.textContent =
                "Unable to get location. Please enter it manually.";

            locationMessage.style.color = "red";
        }
    );
}


// =====================================================
// LOAD DATABASE OPTIONS
// =====================================================

async function loadDropdownData() {

    try {

        const cityResponse =
            await fetch(`${API_BASE_URL}/cities`);

        const cities =
            await cityResponse.json();


        const categoryResponse =
            await fetch(`${API_BASE_URL}/categories`);

        const categories =
            await categoryResponse.json();


        const departmentResponse =
            await fetch(`${API_BASE_URL}/departments`);

        const departments =
            await departmentResponse.json();


        populateSelect(
            "city",
            cities,
            "city_id",
            "city_name",
            "Add City +"
        );


        populateSelect(
            "category",
            categories,
            "category_id",
            "category_name",
            "Add Category +"
        );


        populateSelect(
            "department",
            departments,
            "department_id",
            "department_name",
            "Add Department +"
        );


    } catch (error) {

        console.error(
            "Error loading dropdown data:",
            error
        );

        alert(
            "Could not connect to the backend. " +
            "Please make sure FastAPI is running."
        );
    }
}


// =====================================================
// POPULATE SELECT
// =====================================================

function populateSelect(
    selectId,
    data,
    idField,
    nameField,
    customText
) {

    const select =
        document.getElementById(selectId);


    select.innerHTML =
        '<option value="">Select</option>';


    data.forEach(item => {

        const option =
            document.createElement("option");


        option.value =
            item[idField];


        option.textContent =
            item[nameField];


        select.appendChild(option);
    });


    // Add "Other" option

    const otherOption =
        document.createElement("option");

    otherOption.value = "other";
    otherOption.textContent = customText;

    select.appendChild(otherOption);
}


// =====================================================
// SUBMIT COMPLAINT
// =====================================================

document
    .getElementById("complaintForm")
    .addEventListener(
        "submit",
        async function(event) {

            event.preventDefault();


            // -----------------------------------------
            // GET FORM VALUES
            // -----------------------------------------

            const city =
                document.getElementById("city").value;

            const department =
                document.getElementById("department").value;

            const category =
                document.getElementById("category").value;


            const customCity =
                document
                    .getElementById("customCity")
                    .value
                    .trim();


            const customDepartment =
                document
                    .getElementById("customDepartment")
                    .value
                    .trim();


            const customCategory =
                document
                    .getElementById("customCategory")
                    .value
                    .trim();


            const description =
                document
                    .getElementById("description")
                    .value
                    .trim();


            const location =
                document
                    .getElementById("location")
                    .value
                    .trim();


            const priority =
                document.getElementById("priority").value;


            const name =
                document
                    .getElementById("name")
                    .value
                    .trim();


            const email =
                document
                    .getElementById("email")
                    .value
                    .trim();


            const phone =
                document
                    .getElementById("phone")
                    .value
                    .trim();


            const publicUserId =
                document
                    .getElementById("userId")
                    .value
                    .trim();


            const evidence =
                document
                    .getElementById("evidence")
                    .files[0];


            const message =
                document.getElementById(
                    "userIdMessage"
                );


            // -----------------------------------------
            // BASIC VALIDATION
            // -----------------------------------------

            if (
                !city ||
                city === "other" && !customCity
            ) {

                alert("Please select or enter a city.");

                return;
            }


            if (
                !department ||
                department === "other" && !customDepartment
            ) {

                alert(
                    "Please select or enter a department."
                );

                return;
            }


            if (
                !category ||
                category === "other" && !customCategory
            ) {

                alert(
                    "Please select or enter a category."
                );

                return;
            }


            if (!description) {

                alert(
                    "Please describe the problem."
                );

                return;
            }


            if (!location) {

                alert(
                    "Please enter the problem location."
                );

                return;
            }


            if (!priority) {

                alert(
                    "Please select priority."
                );

                return;
            }


            if (!name || !email || !phone || !publicUserId) {

                alert(
                    "Please fill all user details."
                );

                return;
            }


            if (!evidence) {

                alert(
                    "Please upload an evidence photo."
                );

                return;
            }


            // -----------------------------------------
            // CUSTOM VALUES
            // -----------------------------------------

            if (
                city === "other" ||
                department === "other" ||
                category === "other"
            ) {

                alert(
                    "For this version, please select an existing City, Department and Category from the database."
                );

                return;
            }


            // -----------------------------------------
            // DISABLE BUTTON
            // -----------------------------------------

            const submitButton =
                document.querySelector(
                    "#complaintForm button[type='submit']"
                );


            submitButton.disabled = true;

            submitButton.textContent =
                "Submitting...";


            try {

                // =====================================
                // STEP 1 — CREATE USER
                // =====================================

                const userResponse =
                    await fetch(
                        `${API_BASE_URL}/users`,
                        {

                            method: "POST",

                            headers: {
                                "Content-Type":
                                    "application/json"
                            },

                            body: JSON.stringify({

                                name: name,

                                email: email,

                                phone: phone,

                                public_user_id:
                                    publicUserId
                            })
                        }
                    );


                const userData =
                    await userResponse.json();


                if (!userResponse.ok) {

                    throw new Error(
                        userData.detail ||
                        "Could not create user."
                    );
                }


                const userId =
                    userData.user_id;


                // =====================================
                // STEP 2 — CREATE COMPLAINT
                // =====================================

                const complaintResponse =
                    await fetch(
                        `${API_BASE_URL}/complaints`,
                        {

                            method: "POST",

                            headers: {
                                "Content-Type":
                                    "application/json"
                            },

                            body: JSON.stringify({

                                user_id: userId,

                                city_id:
                                    Number(city),

                                category_id:
                                    Number(category),

                                department_id:
                                    Number(department),

                                description:
                                    description,

                                location:
                                    location,

                                priority:
                                    priority
                            })
                        }
                    );


                const complaintData =
                    await complaintResponse.json();


                if (!complaintResponse.ok) {

                    throw new Error(
                        complaintData.detail ||
                        "Could not submit complaint."
                    );
                }


                // =====================================
                // SUCCESS
                // =====================================

                const complaintId =
                    complaintData.complaint_id;


                message.textContent =
                    "✓ Complaint submitted successfully.";

                message.style.color = "green";


                alert(
                    "Complaint submitted successfully!\n\n" +

                    "Complaint ID: " +
                    complaintId +

                    "\n\nPublic User ID: " +
                    publicUserId +

                    "\n\nStatus: " +
                    (complaintData.status ||
                        "Submitted")
                );


                // Reset form

                document
                    .getElementById("complaintForm")
                    .reset();


                document
                    .getElementById("customCity")
                    .style.display = "none";


                document
                    .getElementById("customDepartment")
                    .style.display = "none";


                document
                    .getElementById("customCategory")
                    .style.display = "none";


                document
                    .getElementById("userIdMessage")
                    .textContent = "";


                document
                    .getElementById("locationMessage")
                    .textContent = "";


                // Update dashboard

                updateDashboard();
            }


            catch (error) {

                console.error(
                    "Submission error:",
                    error
                );


                alert(
                    "❌ Error submitting complaint:\n\n" +
                    error.message
                );
            }


            finally {

                submitButton.disabled = false;

                submitButton.textContent =
                    "Submit Complaint";
            }
        }
    );


// =====================================================
// TRACK COMPLAINT
// =====================================================

async function trackComplaint() {

    let enteredId =
        document
            .getElementById("trackId")
            .value
            .trim()
            .toUpperCase();


    const result =
        document.getElementById(
            "trackingResult"
        );


    if (!enteredId) {

        result.innerHTML =
            "<p>Please enter a Complaint ID.</p>";

        return;
    }


    // Allow CC-123 or 123

    if (enteredId.startsWith("CC-")) {

        enteredId =
            enteredId.replace("CC-", "");
    }


    const complaintId =
        parseInt(enteredId);


    if (isNaN(complaintId)) {

        result.innerHTML =
            "<p>Invalid Complaint ID.</p>";

        return;
    }


    try {

        const response =
            await fetch(
                `${API_BASE_URL}/complaints/${complaintId}`
            );


        const complaint =
            await response.json();


        if (!response.ok) {

            result.innerHTML = `
                <div class="tracking-error">

                    <h3>Complaint Not Found</h3>

                    <p>
                        No complaint was found with this Complaint ID.
                    </p>

                </div>
            `;

            return;
        }


        result.innerHTML = `

            <div class="tracking-card">

                <h3>
                    Complaint CC-${String(
                        complaint.complaint_id
                    ).padStart(6, "0")}
                </h3>

                <p>
                    <strong>Complaint ID:</strong>
                    ${complaint.complaint_id}
                </p>

                <p>
                    <strong>Description:</strong>
                    ${complaint.description || ""}
                </p>

                <p>
                    <strong>Location:</strong>
                    ${complaint.location || ""}
                </p>

                <p>
                    <strong>Priority:</strong>
                    ${complaint.priority || ""}
                </p>

                <p>
                    <strong>Status:</strong>
                    ${complaint.status || ""}
                </p>

                <p>
                    <strong>Submitted:</strong>
                    ${complaint.created_at || ""}
                </p>

            </div>

        `;
    }


    catch (error) {

        console.error(error);

        result.innerHTML =
            "<p>Could not connect to the backend.</p>";
    }
}


// =====================================================
// PUBLIC DASHBOARD
// =====================================================

async function updateDashboard() {

    try {

        const response =
            await fetch(
                `${API_BASE_URL}/complaints`
            );


        if (!response.ok) {

            throw new Error(
                "Could not load complaints."
            );
        }


        const complaints =
            await response.json();


        const total =
            complaints.length;


        const resolved =
            complaints.filter(
                complaint =>
                    complaint.status ===
                    "Resolved"
            ).length;


        const inProgress =
            complaints.filter(
                complaint =>
                    complaint.status ===
                    "In Progress"
            ).length;


        const verified =
            complaints.filter(
                complaint =>
                    complaint.status ===
                    "Verified"
            ).length;


        document
            .getElementById(
                "totalComplaints"
            )
            .textContent = total;


        document
            .getElementById(
                "resolvedComplaints"
            )
            .textContent = resolved;


        document
            .getElementById(
                "progressComplaints"
            )
            .textContent = inProgress;


        document
            .getElementById(
                "verifiedComplaints"
            )
            .textContent = verified;
    }


    catch (error) {

        console.error(
            "Dashboard error:",
            error
        );
    }
}


// =====================================================
// WHEN PAGE LOADS
// =====================================================

document.addEventListener(
    "DOMContentLoaded",
    function() {

        loadDropdownData();

        updateDashboard();
    }
);