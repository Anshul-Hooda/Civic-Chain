/* ============================================================
   CITYFILE — COMPLETE FRONTEND SCRIPT
   Backend contract kept unchanged:
   GET  /cities
   GET  /categories
   GET  /departments
   POST /users
   POST /complaints
   GET  /complaints
   GET  /complaints/{id}
   ============================================================ */

const isLocalFrontend =
    window.location.protocol === "file:" ||
    (["localhost", "127.0.0.1"].includes(window.location.hostname) &&
     window.location.port !== "8000");

const API_BASE_URL = isLocalFrontend
    ? "http://127.0.0.1:8000"
    : "";

const VERIFIED_STATUS = "verified";
const AUTHORITY_RESOLVED_STATUS = "resolved";

const CITY_CENTERS = {
    delhi: [28.6139, 77.2090],
    "new delhi": [28.6139, 77.2090],
    sonipat: [28.9931, 77.0151],
    gurugram: [28.4595, 77.0266],
    gurgaon: [28.4595, 77.0266],
    rohtak: [28.8955, 76.6066]
};

let allComplaints = [];
let activeArchiveFilter = "all";
let activeArchiveBookIndex = 0;
let activeMapFilter = "all";

let cityMap = null;
let mapMarkerLayer = null;

let reportMap = null;
let reportPinMarker = null;
let selectedLatitude = null;
let selectedLongitude = null;

let toastTimer = null;
let refreshTimer = null;

const referenceData = {
    cities: [],
    categories: [],
    departments: [],
    cityById: new Map(),
    categoryById: new Map(),
    departmentById: new Map()
};


/* ============================================================
   HELPERS
   ============================================================ */

function escapeHTML(value = "") {
    return String(value)
        .replaceAll("&", "&amp;")
        .replaceAll("<", "&lt;")
        .replaceAll(">", "&gt;")
        .replaceAll('"', "&quot;")
        .replaceAll("'", "&#039;");
}


function normalizeStatus(complaint) {
    return String(
        complaint?.status || "Submitted"
    )
        .trim()
        .toLowerCase();
}


function isVerified(complaint) {
    return (
        normalizeStatus(complaint) ===
        VERIFIED_STATUS
    );
}


function isAuthorityResolved(complaint) {
    return (
        normalizeStatus(complaint) ===
        AUTHORITY_RESOLVED_STATUS
    );
}


function isInProgress(complaint) {
    return [
        "in progress",
        "in_progress",
        "assigned",
        "acknowledged",
        "working"
    ].includes(
        normalizeStatus(complaint)
    );
}


function formatComplaintId(id) {
    const number = Number(id);

    return Number.isFinite(number)
        ? `CC-${String(number).padStart(6, "0")}`
        : String(id || "UNKNOWN");
}


function formatDate(value) {
    if (!value) {
        return "TIME NOT RECORDED";
    }

    let dateString = String(value).trim();

    // Backend stores timestamps in UTC without timezone information.
    // Tell JavaScript explicitly that the timestamp is UTC.
    if (
        !dateString.endsWith("Z") &&
        !/[+-]\d{2}:\d{2}$/.test(dateString)
    ) {
        dateString += "Z";
    }

    const time = Date.parse(dateString);

    if (!Number.isFinite(time)) {
        return "TIME NOT RECORDED";
    }

    return new Intl.DateTimeFormat(
        "en-IN",
        {
            timeZone: "Asia/Kolkata",
            dateStyle: "medium",
            timeStyle: "short"
        }
    ).format(new Date(time));
}

function complaintAgeMs(complaint) {
    const created = Date.parse(
        complaint?.created_at || ""
    );

    return Number.isFinite(created)
        ? Math.max(0, Date.now() - created)
        : 0;
}


function formatDuration(ms) {
    if (
        !Number.isFinite(ms) ||
        ms <= 0
    ) {
        return "< 1 MIN";
    }

    const totalMinutes = Math.floor(
        ms / 60000
    );

    const days = Math.floor(
        totalMinutes / 1440
    );

    const hours = Math.floor(
        (totalMinutes % 1440) / 60
    );

    const minutes = totalMinutes % 60;

    if (days > 0) {
        return `${days}D ${hours}H`;
    }

    if (hours > 0) {
        return `${hours}H ${minutes}M`;
    }

    return `${minutes}M`;
}


function getCityName(complaint) {
    return (
        complaint?.city_name ||
        referenceData.cityById.get(
            Number(complaint?.city_id)
        ) ||
        "CITY NOT LISTED"
    );
}


function getCategoryName(complaint) {
    return (
        complaint?.category_name ||
        referenceData.categoryById.get(
            Number(complaint?.category_id)
        ) ||
        "CIVIC PROBLEM"
    );
}


function getDepartmentName(complaint) {
    return (
        complaint?.department_name ||
        referenceData.departmentById.get(
            Number(complaint?.department_id)
        ) ||
        "DEPARTMENT NOT LISTED"
    );
}


function getBlockchainHash(complaint) {
    return (
        complaint?.blockchain_tx_hash ||
        complaint?.tx_hash ||
        complaint?.transaction_hash ||
        ""
    );
}


function publicLocation(complaint) {
    return String(
        complaint?.location ||
        getCityName(complaint)
    )
        .replace(
            /\s*\|\s*Latitude:\s*-?\d+(?:\.\d+)?,\s*Longitude:\s*-?\d+(?:\.\d+)?/i,
            ""
        )
        .trim();
}


function issueGroup(complaint) {
    const text = [
        getCategoryName(complaint),
        getDepartmentName(complaint),
        complaint?.description,
        complaint?.location
    ]
        .join(" ")
        .toLowerCase();

    if (
        /streetlight|street light|lighting|lamp|dark road/.test(text)
    ) {
        return "streetlight";
    }

    if (
        /drain|drainage|sewage|sewer|waterlogging|blocked drain/.test(text)
    ) {
        return "drainage";
    }

    if (
        /water leak|leakage|pipeline|water supply|pipe|water/.test(text)
    ) {
        return "water";
    }

    if (
        /garbage|waste|sanitation|bin|trash/.test(text)
    ) {
        return "sanitation";
    }

    if (
        /theft|safety|unsafe|police|crime|harassment/.test(text)
    ) {
        return "safety";
    }

    if (
        /pothole|road|street|highway|broken road|accident/.test(text)
    ) {
        return "road";
    }

    return "other";
}


function homeStatusLabel(complaint) {
    if (isVerified(complaint)) {
        return "CITIZEN VERIFIED";
    }

    if (isAuthorityResolved(complaint)) {
        return "VERIFY FIX";
    }

    if (isInProgress(complaint)) {
        return "IN PROGRESS";
    }

    const status = normalizeStatus(
        complaint
    );

    if (
        status === "submitted" ||
        status === "open"
    ) {
        return "AWAITING ACTION";
    }

    return String(
        complaint?.status ||
        "Submitted"
    ).toUpperCase();
}


function currentUnresolvedComplaints() {
    return allComplaints.filter(
        complaint => !isVerified(complaint)
    );
}


function showToast(message) {
    const toast = document.getElementById(
        "toast"
    );

    if (!toast) {
        return;
    }

    toast.textContent = message;
    toast.classList.add("show");

    clearTimeout(toastTimer);

    toastTimer = setTimeout(
        () => {
            toast.classList.remove("show");
        },
        3200
    );
}


async function fetchJSON(
    path,
    options = {}
) {
    const response = await fetch(
        `${API_BASE_URL}${path}`,
        options
    );

    let data = null;

    try {
        data = await response.json();
    }
    catch {
        data = null;
    }

    if (!response.ok) {
        throw new Error(
            data?.detail ||
            data?.message ||
            `Request failed (${response.status})`
        );
    }

    return data;
}


/* ============================================================
   NAVIGATION
   ============================================================ */

function showView(viewName) {
    const requested =
        document.querySelector(
            `[data-view-name="${viewName}"]`
        );

    if (!requested) {
        return;
    }

    const isMobile =
    window.matchMedia("(max-width: 680px)").matches;

const isSeparateMobileView =
    viewName === "report" ||
    viewName === "map";

document.body.classList.toggle(
    "mobile-separate-view",
    isMobile && isSeparateMobileView
);

    document
        .querySelectorAll(".view")
        .forEach(
            view => {
                view.classList.toggle(
                    "active-view",
                    view === requested
                );
            }
        );

    document
        .querySelectorAll(".nav-link")
        .forEach(
            button => {
                button.classList.toggle(
                    "active",
                    button.dataset.view === viewName
                );
            }
        );

    if (window.innerWidth <= 680) {
    requested.scrollIntoView({
        behavior: "smooth",
        block: "start"
    });
} else {
    window.scrollTo({
        top: 0,
        behavior: "auto"
    });
}

    if (viewName === "map") {
        setTimeout(
            () => {
                initializeCityMap();
                cityMap?.invalidateSize();
                renderMapMarkers();
            },
            100
        );
    }

    if (viewName === "report") {
        setTimeout(
            () => {
                initializeReportMap();
                reportMap?.invalidateSize();
            },
            100
        );
    }

    if (viewName === "archive") {
        renderArchive();
    }

    if (viewName === "profile") {
        renderProfileFiles();
    }

    if (viewName === "integrity") {
        renderIntegrityEvents();
    }
}


function openMapFor(
    filter = "all"
) {
    activeMapFilter = filter;

    syncMapFilterButtons();

    showView("map");

    setTimeout(
        renderMapMarkers,
        120
    );
}


function initializeNavigation() {
    document.addEventListener(
        "click",
        event => {
            const viewButton =
                event.target.closest(
                    "[data-view]"
                );

            if (viewButton) {
                showView(
                    viewButton.dataset.view
                );

                return;
            }

            const marker =
                event.target.closest(
                    ".city-record-marker[data-map-filter]"
                );

            if (marker) {
                openMapFor(
                    marker.dataset.mapFilter ||
                    "all"
                );
            }
        }
    );

    document
        .getElementById(
            "verifiedFixesCard"
        )
        ?.addEventListener(
            "click",
            () => {
                activeArchiveFilter =
                    "verified";

                syncArchiveFilterButtons();

                showView(
                    "archive"
                );
            }
        );
}


/* ============================================================
   REFERENCE DATA
   ============================================================ */

function fillSelect(
    selectId,
    items,
    idKey,
    labelKey,
    placeholder
) {
    const select =
        document.getElementById(
            selectId
        );

    if (!select) {
        return;
    }

    select.innerHTML =
        `<option value="">${escapeHTML(
            placeholder
        )}</option>`;

    items.forEach(
        item => {
            const option =
                document.createElement(
                    "option"
                );

            option.value =
                item[idKey];

            option.textContent =
                item[labelKey];

            select.appendChild(
                option
            );
        }
    );
}


async function loadReferenceData() {
    try {
        const [
            cities,
            categories,
            departments
        ] =
            await Promise.all([
                fetchJSON("/cities"),
                fetchJSON("/categories"),
                fetchJSON("/departments")
            ]);

        referenceData.cities =
            Array.isArray(cities)
                ? cities
                : [];

        referenceData.categories =
            Array.isArray(categories)
                ? categories
                : [];

        referenceData.departments =
            Array.isArray(departments)
                ? departments
                : [];

        referenceData.cityById =
            new Map(
                referenceData
                    .cities
                    .map(
                        item => [
                            Number(
                                item.city_id
                            ),
                            item.city_name
                        ]
                    )
            );

        referenceData.categoryById =
            new Map(
                referenceData
                    .categories
                    .map(
                        item => [
                            Number(
                                item.category_id
                            ),
                            item.category_name
                        ]
                    )
            );

        referenceData.departmentById =
            new Map(
                referenceData
                    .departments
                    .map(
                        item => [
                            Number(
                                item.department_id
                            ),
                            item.department_name
                        ]
                    )
            );

        fillSelect(
            "city",
            referenceData.cities,
            "city_id",
            "city_name",
            "Select city"
        );

        fillSelect(
            "category",
            referenceData.categories,
            "category_id",
            "category_name",
            "Select category"
        );

        fillSelect(
            "department",
            referenceData.departments,
            "department_id",
            "department_name",
            "Select department"
        );
    }
    catch (error) {
        console.error(
            "Reference data error:",
            error
        );

        showToast(
            "Could not load cities, categories and departments."
        );
    }
}


/* ============================================================
   LOAD DATA + HOME
   ============================================================ */

async function loadComplaints({
    silent = false
} = {}) {
    try {
        const complaints =
            await fetchJSON(
                "/complaints"
            );

        allComplaints =
            Array.isArray(
                complaints
            )
                ? complaints
                : [];

        updateHomeMetrics();
        renderHomeProblemFiles();
        renderArchive();
        renderMapMarkers();
        renderProfileFiles();
        renderIntegrityEvents();

        return allComplaints;
    }
    catch (error) {
        console.error(
            "Complaint loading error:",
            error
        );

        if (!silent) {
            showToast(
                "Could not load complaint records from the backend."
            );
        }

        return [];
    }
}


function startDataRefresh() {
    clearInterval(
        refreshTimer
    );

    refreshTimer =
        setInterval(
            () => {
                loadComplaints({
                    silent: true
                });
            },
            60000
        );
}


function updateHomeMetrics() {
    const unresolved =
        currentUnresolvedComplaints();

    const verified =
        allComplaints.filter(
            isVerified
        );

    const awaitingVerification =
        unresolved.filter(
            isAuthorityResolved
        );

    const awaitingAction =
        unresolved.filter(
            complaint => {
                const status =
                    normalizeStatus(
                        complaint
                    );

                return (
                    status === "submitted" ||
                    status === "open"
                );
            }
        );

    const values = {
        homeOpenCount:
            unresolved.length,

        homeAwaitingAction:
            awaitingAction.length,

        homeAwaitingVerification:
            awaitingVerification.length,

        verifiedFixes:
            verified.length
    };

    Object.entries(
        values
    ).forEach(
        ([id, value]) => {
            const element =
                document.getElementById(
                    id
                );

            if (element) {
                element.textContent =
                    Number(value)
                        .toLocaleString(
                            "en-IN"
                        );
            }
        }
    );
}


function renderHomeProblemFiles() {
    const container =
        document.getElementById(
            "homeProblemFiles"
        );

    if (!container) {
        return;
    }

    const records =
        currentUnresolvedComplaints()
            .slice()
            .sort(
                (a, b) =>
                    complaintAgeMs(b) -
                    complaintAgeMs(a)
            )
            .slice(
                0,
                3
            );

    container.innerHTML = "";

    if (!records.length) {
        container.innerHTML = `
            <div class="empty-state">
                No active records loaded.
            </div>
        `;

        return;
    }

    records.forEach(
        complaint => {
            const button =
                document.createElement(
                    "button"
                );

            button.type = "button";

            button.className =
                "home-live-file";

            button.innerHTML = `
                <div class="home-file-id">
                    <span>
                        ${escapeHTML(
                            formatComplaintId(
                                complaint.complaint_id
                            )
                        )}
                    </span>

                    <span>
                        ${escapeHTML(
                            formatDuration(
                                complaintAgeMs(
                                    complaint
                                )
                            )
                        )}
                    </span>
                </div>

                <strong class="home-file-category">
                    ${escapeHTML(
                        getCategoryName(
                            complaint
                        )
                    )}
                </strong>

                <span class="home-file-location">
                    ${escapeHTML(
                        publicLocation(
                            complaint
                        )
                    )}
                </span>

                <div class="home-file-state">
                    <span>
                        ${escapeHTML(
                            getDepartmentName(
                                complaint
                            )
                        )}
                    </span>

                    <strong>
                        ${escapeHTML(
                            homeStatusLabel(
                                complaint
                            )
                        )}
                    </strong>
                </div>
            `;

            button.addEventListener(
                "click",
                () => {
                    openCase(
                        complaint.complaint_id
                    );
                }
            );

            container.appendChild(
                button
            );
        }
    );
}


/* ============================================================
   OPEN FILES — PUBLIC ARCHIVE
   ============================================================ */

function syncArchiveFilterButtons() {
    document
        .querySelectorAll(
            "[data-archive-filter]"
        )
        .forEach(
            button => {
                button.classList.toggle(
                    "active",
                    button.dataset
                        .archiveFilter ===
                    activeArchiveFilter
                );
            }
        );
}


function lifecycleStates(
    complaint
) {
    const status =
        normalizeStatus(
            complaint
        );

    const acknowledged =
        ![
            "submitted",
            "open",
            ""
        ].includes(
            status
        );

    const actionRecorded =
        [
            "in progress",
            "in_progress",
            "working",
            "resolved",
            "verified"
        ].includes(
            status
        );

    const authorityResolved =
        isAuthorityResolved(
            complaint
        ) ||
        isVerified(
            complaint
        );

    const citizenVerified =
        isVerified(
            complaint
        );

    return [
        {
            label: "REPORT",
            state: "complete"
        },

        {
            label: "ACK",
            state:
                acknowledged
                    ? "complete"
                    : "waiting"
        },

        {
            label: "ACTION",
            state:
                actionRecorded
                    ? "complete"
                    : acknowledged
                        ? "current"
                        : "waiting"
        },

        {
            label: "CITY FIX",
            state:
                authorityResolved
                    ? "complete"
                    : actionRecorded
                        ? "current"
                        : "waiting"
        },

        {
            label: "VERIFY",
            state:
                citizenVerified
                    ? "complete"
                    : authorityResolved
                        ? "current"
                        : "waiting"
        }
    ];
}


function lifecycleMarkup(
    complaint,
    className = "record-route"
) {
    const steps =
        lifecycleStates(
            complaint
        );

    return `
        <div class="${className}">
            ${steps.map(
                (step, index) => `
                    <span
                        class="route-step ${step.state}"
                    >
                        <i></i>

                        <b>
                            ${step.label}
                        </b>
                    </span>

                    ${
                        index <
                        steps.length - 1

                            ? `
                                <span
                                    class="route-bridge ${step.state}"
                                >
                                </span>
                            `

                            : ""
                    }
                `
            ).join("")}
        </div>
    `;
}


function createFileCard(
    complaint,
    index = 0
) {
    const row =
        document.createElement(
            "article"
        );

    row.className =
        `ledger-record${
            isVerified(
                complaint
            )
                ? " is-verified"
                : ""
        }${
            isAuthorityResolved(
                complaint
            )
                ? " needs-verification"
                : ""
        }`;

    const verified =
        isVerified(
            complaint
        );

    const age =
        verified
            ? "VERIFIED CLOSURE"
            : formatDuration(
                complaintAgeMs(
                    complaint
                )
            );

    row.innerHTML = `
        <div
            class="ledger-record-number"
            aria-hidden="true"
        >
            ${String(
                index + 1
            ).padStart(
                2,
                "0"
            )}
        </div>

        <div class="ledger-record-body">

            <div class="ledger-record-head">

                <div>

                    <span class="ledger-record-id">
                        ${escapeHTML(
                            formatComplaintId(
                                complaint.complaint_id
                            )
                        )}
                    </span>

                    <h3>
                        ${escapeHTML(
                            getCategoryName(
                                complaint
                            )
                        )}
                    </h3>

                    <p>
                        ${escapeHTML(
                            publicLocation(
                                complaint
                            )
                        )}
                    </p>

                </div>

                <div class="ledger-record-state">

                    <span class="status-beacon"></span>

                    <strong>
                        ${escapeHTML(
                            homeStatusLabel(
                                complaint
                            )
                        )}
                    </strong>

                    <small>
                        ${
                            verified
                                ? "record remains public"
                                : `${
                                    escapeHTML(
                                        age
                                    )
                                } IN PUBLIC RECORD`
                        }
                    </small>

                </div>

            </div>

            ${
                lifecycleMarkup(
                    complaint
                )
            }

            <div class="ledger-record-foot">

                <span>
                    <small>
                        RESPONSIBLE
                    </small>

                    <strong>
                        ${escapeHTML(
                            getDepartmentName(
                                complaint
                            )
                        )}
                    </strong>
                </span>

                <span>
                    <small>
                        SUBMITTED
                    </small>

                    <strong>
                        ${escapeHTML(
                            formatDate(
                                complaint.created_at
                            )
                        )}
                    </strong>
                </span>

                <button
                    type="button"
                    class="open-file-btn"
                >
                    INSPECT RECORD →
                </button>

            </div>

        </div>
    `;

    row
        .querySelector(
            ".open-file-btn"
        )
        ?.addEventListener(
            "click",
            () => {
                openCase(
                    complaint.complaint_id
                );
            }
        );

    row.addEventListener(
        "dblclick",
        () => {
            openCase(
                complaint.complaint_id
            );
        }
    );

    return row;
}


function getFilteredArchiveComplaints() {
    let complaints = [...allComplaints];

    if (
        activeArchiveFilter ===
        "verified"
    ) {
        complaints =
            complaints.filter(
                isVerified
            );
    }

    if (
        activeArchiveFilter ===
        "unresolved"
    ) {
        complaints =
            complaints.filter(
                complaint =>
                    !isVerified(
                        complaint
                    )
            );
    }

    complaints.sort(
        (a, b) =>
            (
                Date.parse(
                    b.created_at || ""
                ) || 0
            )
            -
            (
                Date.parse(
                    a.created_at || ""
                ) || 0
            )
    );

    return complaints;
}


function bookStatusClass(
    complaint
) {
    if (
        isVerified(
            complaint
        )
    ) {
        return "verified";
    }

    if (
        isAuthorityResolved(
            complaint
        )
    ) {
        return "verify";
    }

    if (
        isInProgress(
            complaint
        )
    ) {
        return "progress";
    }

    return "open";
}


function renderArchiveBook(
    animateDirection = ""
) {
    const left =
        document.getElementById(
            "bookLeftPage"
        );

    const right =
        document.getElementById(
            "bookRightPage"
        );

    const counter =
        document.getElementById(
            "bookRecordCounter"
        );

    const previous =
        document.getElementById(
            "bookPrevious"
        );

    const next =
        document.getElementById(
            "bookNext"
        );

    const book =
        document.getElementById(
            "civicBook"
        );

    if (
        !left ||
        !right
    ) {
        return;
    }

    const complaints =
        getFilteredArchiveComplaints();

    /* EMPTY ARCHIVE */

    if (!complaints.length) {
        activeArchiveBookIndex = 0;

        if (counter) {
            counter.textContent =
                "00 / 00";
        }

        if (previous) {
            previous.disabled =
                true;
        }

        if (next) {
            next.disabled =
                true;
        }

        left.innerHTML = `
            <div class="book-empty">

                <span class="book-empty-number">
                    00
                </span>

                <h3>
                    No records yet.
                </h3>

                <p>
                    The archive is still here.
                    The first civic problem reported
                    through CITYFILE will begin the
                    public record.
                </p>

            </div>
        `;

        right.innerHTML = `
            <div class="book-empty">

                <span class="book-description-label">
                    THE PUBLIC RECORD BEGINS HERE
                </span>

                <h3>
                    Nothing to flip through — yet.
                </h3>

                <p>
                    When a complaint is created,
                    its status, responsible department
                    and accountability trail will
                    remain inspectable on these pages.
                </p>

                <button
                    type="button"
                    class="book-empty-action"
                    data-view="report"
                >
                    + REPORT A PROBLEM
                </button>

            </div>
        `;

        return;
    }

    activeArchiveBookIndex =
        Math.max(
            0,
            Math.min(
                activeArchiveBookIndex,
                complaints.length - 1
            )
        );

    const complaint =
        complaints[
            activeArchiveBookIndex
        ];

    const states =
        lifecycleStates(
            complaint
        );

    const id =
        formatComplaintId(
            complaint.complaint_id
        );

    const status =
        homeStatusLabel(
            complaint
        );

    const age =
        isVerified(
            complaint
        )
            ? "CLOSED / VERIFIED"
            : `${formatDuration(
                complaintAgeMs(
                    complaint
                )
            )} OPEN`;

    if (counter) {
        counter.textContent =
            `${String(
                activeArchiveBookIndex + 1
            ).padStart(
                2,
                "0"
            )} / ${String(
                complaints.length
            ).padStart(
                2,
                "0"
            )}`;
    }

    if (previous) {
        previous.disabled =
            complaints.length < 2;
    }

    if (next) {
        next.disabled =
            complaints.length < 2;
    }

    /* LEFT BOOK PAGE */

    left.innerHTML = `

        <div class="book-file-number">

            <span>
                PUBLIC PROBLEM FILE
            </span>

            <span>
                ${escapeHTML(id)}
            </span>

        </div>

        <h3 class="book-category">
            ${escapeHTML(
                getCategoryName(
                    complaint
                )
            )}
        </h3>

        <p class="book-location">
            ${escapeHTML(
                publicLocation(
                    complaint
                )
            )}
        </p>

        <span class="book-description-label">
            WHAT WAS REPORTED
        </span>

        <p class="book-description">
            ${escapeHTML(
                complaint.description ||
                "No description recorded."
            )}
        </p>

        <div class="book-meta-grid">

            <div>
                <span class="book-meta-label">
                    SUBMITTED
                </span>

                <strong>
                    ${escapeHTML(
                        formatDate(
                            complaint.created_at
                        )
                    )}
                </strong>
            </div>

            <div>
                <span class="book-meta-label">
                    PRIORITY
                </span>

                <strong>
                    ${escapeHTML(
                        complaint.priority ||
                        "NOT RECORDED"
                    )}
                </strong>
            </div>

            <div>
                <span class="book-meta-label">
                    CITY
                </span>

                <strong>
                    ${escapeHTML(
                        getCityName(
                            complaint
                        )
                    )}
                </strong>
            </div>

            <div>
                <span class="book-meta-label">
                    TIME / STATE
                </span>

                <strong>
                    ${escapeHTML(age)}
                </strong>
            </div>

        </div>
    `;

    /* RIGHT BOOK PAGE */

    right.innerHTML = `

        <div
            class="book-status-stamp
            ${bookStatusClass(
                complaint
            )}"
        >
            ● ${escapeHTML(status)}
        </div>

        <h3 class="book-right-title">
            Accountability trail
        </h3>

        <div class="book-route">

            ${states.map(
                step => `

                    <div
                        class="book-route-step
                        ${step.state}"
                    >

                        <i></i>

                        <div>

                            <strong>
                                ${escapeHTML(
                                    step.label
                                )}
                            </strong>

                            <span>
                                ${
                                    step.state ===
                                    "complete"

                                        ? "RECORDED"

                                        : step.state ===
                                          "current"

                                            ? "CURRENT STAGE"

                                            : "WAITING"
                                }
                            </span>

                        </div>

                    </div>

                `
            ).join("")}

        </div>

        <div class="book-meta-grid">

            <div
                style="grid-column:1/-1"
            >

                <span class="book-meta-label">
                    RESPONSIBLE DEPARTMENT
                </span>

                <strong>
                    ${escapeHTML(
                        getDepartmentName(
                            complaint
                        )
                    )}
                </strong>

            </div>

        </div>

        <button
            type="button"
            class="book-open-record"
            data-book-open-id="${
                Number(
                    complaint.complaint_id
                )
            }"
        >
            INSPECT COMPLETE RECORD →
        </button>
    `;

    right
        .querySelector(
            "[data-book-open-id]"
        )
        ?.addEventListener(
            "click",
            () => {
                openCase(
                    complaint.complaint_id
                );
            }
        );

    /* PAGE FLIP */

    if (
        book &&
        animateDirection
    ) {
        book.classList.remove(
            "flipping-next",
            "flipping-prev"
        );

        void book.offsetWidth;

        book.classList.add(
            animateDirection === "next"
                ? "flipping-next"
                : "flipping-prev"
        );

        window.setTimeout(
            () => {
                book.classList.remove(
                    "flipping-next",
                    "flipping-prev"
                );
            },
            560
        );
    }
}


function changeArchiveBook(
    direction
) {
    const complaints =
        getFilteredArchiveComplaints();

    if (
        complaints.length < 2
    ) {
        return;
    }

    activeArchiveBookIndex =
        (
            activeArchiveBookIndex +
            direction +
            complaints.length
        )
        %
        complaints.length;

    renderArchiveBook(
        direction > 0
            ? "next"
            : "prev"
    );
}


function renderArchive() {
    const grid =
        document.getElementById(
            "archiveGrid"
        );

    if (!grid) {
        return;
    }

    const unresolved =
        allComplaints.filter(
            complaint =>
                !isVerified(
                    complaint
                )
        );

    const inProgress =
        unresolved.filter(
            isInProgress
        );

    const awaitingVerification =
        unresolved.filter(
            isAuthorityResolved
        );

    const verified =
        allComplaints.filter(
            isVerified
        );

    const counts = {
        archiveOpenCount:
            unresolved.length,

        archiveProgressCount:
            inProgress.length,

        archiveVerifyCount:
            awaitingVerification.length,

        archiveVerifiedCount:
            verified.length
    };

    Object.entries(
        counts
    ).forEach(
        ([id, value]) => {
            const element =
                document.getElementById(
                    id
                );

            if (element) {
                element.textContent =
                    Number(value)
                        .toLocaleString(
                            "en-IN"
                        );
            }
        }
    );

    /*
       archiveGrid remains in HTML
       as a compatibility hook.

       The visible archive is the book.
    */

    grid.innerHTML = "";

    renderArchiveBook();
}


function initializeArchiveFilters() {
    document
        .getElementById(
            "archiveFilters"
        )
        ?.addEventListener(
            "click",
            event => {
                const button =
                    event.target.closest(
                        "[data-archive-filter]"
                    );

                if (!button) {
                    return;
                }

                activeArchiveFilter =
                    button.dataset
                        .archiveFilter;

                activeArchiveBookIndex = 0;

                syncArchiveFilterButtons();

                renderArchive();
            }
        );

    document
        .getElementById(
            "refreshArchive"
        )
        ?.addEventListener(
            "click",
            () => {
                loadComplaints();
            }
        );

    document
        .getElementById(
            "bookPrevious"
        )
        ?.addEventListener(
            "click",
            () => {
                changeArchiveBook(-1);
            }
        );

    document
        .getElementById(
            "bookNext"
        )
        ?.addEventListener(
            "click",
            () => {
                changeArchiveBook(1);
            }
        );

    document.addEventListener(
        "keydown",
        event => {
            const archive =
                document.getElementById(
                    "archiveView"
                );

            if (
                !archive?.classList.contains(
                    "active-view"
                )
            ) {
                return;
            }

            if (
                event.key ===
                "ArrowLeft"
            ) {
                changeArchiveBook(-1);
            }

            if (
                event.key ===
                "ArrowRight"
            ) {
                changeArchiveBook(1);
            }
        }
    );
}


/* ============================================================
   MAP
   ============================================================ */

function createTileLayer() {
    return L.tileLayer(
        "https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png",
        {
            maxZoom: 19,

            attribution:
                "&copy; OpenStreetMap contributors"
        }
    );
}


function initializeCityMap() {
    if (
        cityMap ||
        typeof L === "undefined" ||
        !document.getElementById(
            "cityMap"
        )
    ) {
        return;
    }

    cityMap =
        L.map(
            "cityMap",
            {
                center:
                    CITY_CENTERS.delhi,

                zoom: 11
            }
        );

    createTileLayer()
        .addTo(
            cityMap
        );

    mapMarkerLayer =
        L.layerGroup()
            .addTo(
                cityMap
            );

    renderMapMarkers();
}


function initializeReportMap() {
    if (
        reportMap ||
        typeof L === "undefined" ||
        !document.getElementById(
            "reportMap"
        )
    ) {
        return;
    }

    reportMap =
        L.map(
            "reportMap",
            {
                center:
                    CITY_CENTERS.delhi,

                zoom: 12
            }
        );

    createTileLayer()
        .addTo(
            reportMap
        );

    reportMap.on(
        "click",
        event => {
            setReportPin(
                event.latlng.lat,
                event.latlng.lng
            );
        }
    );
}


function extractCoordinates(
    complaint
) {
    const raw =
        String(
            complaint?.location || ""
        );

    const match =
        raw.match(
            /Latitude:\s*(-?\d+(?:\.\d+)?),\s*Longitude:\s*(-?\d+(?:\.\d+)?)/i
        );

    if (match) {
        return [
            Number(match[1]),
            Number(match[2])
        ];
    }

    return null;
}


function deterministicOffset(id) {
    const text =
        String(
            id ?? "0"
        );

    let hash = 0;

    for (
        const char of text
    ) {
        hash =
            (
                (
                    hash * 31
                ) +
                char.charCodeAt(0)
            )
            >>> 0;
    }

    return [
        (
            (
                hash % 1000
            )
            / 1000
            - .5
        )
        * .09,

        (
            (
                (
                    hash >> 8
                )
                % 1000
            )
            / 1000
            - .5
        )
        * .09
    ];
}


function complaintCoordinates(
    complaint
) {
    const exact =
        extractCoordinates(
            complaint
        );

    if (exact) {
        return exact;
    }

    const center =
        CITY_CENTERS[
            getCityName(
                complaint
            )
                .trim()
                .toLowerCase()
        ]
        ||
        CITY_CENTERS.delhi;

    const [
        latOffset,
        lngOffset
    ] =
        deterministicOffset(
            complaint.complaint_id
        );

    return [
        center[0] +
        latOffset,

        center[1] +
        lngOffset
    ];
}


function syncMapFilterButtons() {
    document
        .querySelectorAll(
            "[data-map-filter]"
        )
        .forEach(
            button => {
                if (
                    button.classList.contains(
                        "map-filter"
                    )
                ) {
                    button.classList.toggle(
                        "active",
                        button.dataset
                            .mapFilter ===
                        activeMapFilter
                    );
                }
            }
        );
}


function renderMapMarkers() {
    if (
        !cityMap ||
        !mapMarkerLayer ||
        typeof L === "undefined"
    ) {
        return;
    }

    mapMarkerLayer.clearLayers();

    const records =
        currentUnresolvedComplaints()
            .filter(
                complaint => {
                    return (
                        activeMapFilter ===
                        "all"
                        ||
                        issueGroup(
                            complaint
                        ) ===
                        activeMapFilter
                    );
                }
            );

    const visible =
        document.getElementById(
            "visibleMapCount"
        );

    if (visible) {
        visible.textContent =
            records.length;
    }

    const message =
        document.getElementById(
            "mapMessage"
        );

    if (message) {
        message.textContent =
            records.length
                ? ""
                : "No unresolved records match this filter.";
    }

    records.forEach(
        complaint => {
            const [
                lat,
                lng
            ] =
                complaintCoordinates(
                    complaint
                );

            const marker =
                L.circleMarker(
                    [lat, lng],
                    {
                        radius:
                            isAuthorityResolved(
                                complaint
                            )
                                ? 8
                                : 7,

                        weight: 2,

                        color:
                            isAuthorityResolved(
                                complaint
                            )
                                ? "#9b89b5"
                                : "#c59a62",

                        fillColor:
                            isAuthorityResolved(
                                complaint
                            )
                                ? "#9b89b5"
                                : "#c59a62",

                        fillOpacity:
                            isAuthorityResolved(
                                complaint
                            )
                                ? .15
                                : .7
                    }
                );

            marker.bindPopup(`
                <strong>
                    ${escapeHTML(
                        formatComplaintId(
                            complaint.complaint_id
                        )
                    )}
                </strong>

                <br>

                ${escapeHTML(
                    getCategoryName(
                        complaint
                    )
                )}

                <br>

                ${escapeHTML(
                    publicLocation(
                        complaint
                    )
                )}

                <br>

                <button
                    type="button"
                    onclick="window.openCase(${Number(
                        complaint.complaint_id
                    )})"
                >
                    OPEN FILE →
                </button>
            `);

            marker.addTo(
                mapMarkerLayer
            );
        }
    );
}


function initializeMapFilters() {
    document
        .getElementById(
            "mapFilters"
        )
        ?.addEventListener(
            "click",
            event => {
                const button =
                    event.target.closest(
                        "[data-map-filter]"
                    );

                if (!button) {
                    return;
                }

                activeMapFilter =
                    button.dataset
                        .mapFilter ||
                    "all";

                syncMapFilterButtons();

                renderMapMarkers();
            }
        );
}


/* ============================================================
   REPORT MAP + GEOLOCATION
   ============================================================ */

function setReportPin(
    lat,
    lng
) {
    selectedLatitude =
        Number(lat);

    selectedLongitude =
        Number(lng);

    if (
        !reportMap ||
        typeof L === "undefined"
    ) {
        return;
    }

    if (!reportPinMarker) {
        reportPinMarker =
            L.marker(
                [lat, lng]
            )
                .addTo(
                    reportMap
                );
    }
    else {
        reportPinMarker
            .setLatLng(
                [lat, lng]
            );
    }

    const pinCoordinates =
        document.getElementById(
            "pinCoordinates"
        );

    if (pinCoordinates) {
        pinCoordinates.textContent =
            `${lat.toFixed(5)}, ${lng.toFixed(5)}`;
    }
}


function clearReportPin() {
    selectedLatitude = null;
    selectedLongitude = null;

    if (
        reportMap &&
        reportPinMarker
    ) {
        reportMap.removeLayer(
            reportPinMarker
        );
    }

    reportPinMarker = null;

    const pinCoordinates =
        document.getElementById(
            "pinCoordinates"
        );

    if (pinCoordinates) {
        pinCoordinates.textContent =
            "NO PIN";
    }
}


function getLocation() {
    const message =
        document.getElementById(
            "locationMessage"
        );

    if (!navigator.geolocation) {
        if (message) {
            message.textContent =
                "Location is not supported by this browser.";
        }

        return;
    }

    if (message) {
        message.textContent =
            "Finding your location…";
    }

    navigator.geolocation
        .getCurrentPosition(

            position => {
                const {
                    latitude,
                    longitude
                } =
                    position.coords;

                setReportPin(
                    latitude,
                    longitude
                );

                reportMap
                    ?.setView(
                        [
                            latitude,
                            longitude
                        ],
                        16
                    );

                const location =
                    document.getElementById(
                        "location"
                    );

                if (
                    location &&
                    !location.value.trim()
                ) {
                    location.value =
                        "Pinned current location";
                }

                if (message) {
                    message.textContent =
                        "Location pinned. You can refine it by clicking the map.";
                }
            },

            error => {
                if (message) {
                    message.textContent =
                        error.message ||
                        "Could not access your location.";
                }
            },

            {
                enableHighAccuracy: true,
                timeout: 10000
            }
        );
}


function locationPayloadFromForm() {
    const location =
        document
            .getElementById(
                "location"
            )
            ?.value
            .trim()
        || "";

    if (
        Number.isFinite(
            selectedLatitude
        )
        &&
        Number.isFinite(
            selectedLongitude
        )
    ) {
        return (
            `${location} | ` +
            `Latitude: ${selectedLatitude}, ` +
            `Longitude: ${selectedLongitude}`
        );
    }

    return location;
}/* ============================================================
   EVIDENCE + SUBMISSION
   ============================================================ */

function initializeEvidencePreview() {
    const input =
        document.getElementById(
            "evidence"
        );

    const preview =
        document.getElementById(
            "evidencePreview"
        );

    if (
        !input ||
        !preview
    ) {
        return;
    }

    input.addEventListener(
        "change",
        () => {
            preview.innerHTML = "";

            const files =
                Array.from(
                    input.files || []
                );

            if (!files.length) {
                preview.innerHTML = `
                    <span class="evidence-empty">
                        No evidence selected.
                    </span>
                `;

                return;
            }

            files.forEach(
                file => {
                    const item =
                        document.createElement(
                            "div"
                        );

                    item.className =
                        "evidence-preview-item";

                    if (
                        file.type.startsWith(
                            "image/"
                        )
                    ) {
                        const image =
                            document.createElement(
                                "img"
                            );

                        const objectURL =
                            URL.createObjectURL(
                                file
                            );

                        image.src =
                            objectURL;

                        image.alt =
                            file.name;

                        image.onload =
                            () => {
                                URL.revokeObjectURL(
                                    objectURL
                                );
                            };

                        item.appendChild(
                            image
                        );
                    }

                    const name =
                        document.createElement(
                            "span"
                        );

                    name.textContent =
                        file.name;

                    item.appendChild(
                        name
                    );

                    preview.appendChild(
                        item
                    );
                }
            );
        }
    );
}


function saveMyComplaintId(id) {
    let ids = [];

    try {
        const parsed =
            JSON.parse(
                localStorage.getItem(
                    "cityfile_my_complaints"
                ) || "[]"
            );

        ids =
            Array.isArray(parsed)
                ? parsed.map(String)
                : [];
    }
    catch {
        ids = [];
    }

    const value =
        String(id);

    if (
        !ids.includes(
            value
        )
    ) {
        ids.unshift(
            value
        );
    }

    localStorage.setItem(
        "cityfile_my_complaints",
        JSON.stringify(ids)
    );
}


function getReporterPayload() {
    const name =
        document
            .getElementById(
                "reporterName"
            )
            ?.value
            .trim()
        || "";

    const email =
        document
            .getElementById(
                "reporterEmail"
            )
            ?.value
            .trim()
        || "";

    const phone =
        document
            .getElementById(
                "reporterPhone"
            )
            ?.value
            .trim()
        || "";

    return {
        name,
        email,
        phone
    };
}


async function createReporterIfNeeded() {
    const reporter =
        getReporterPayload();

    /*
       CITYFILE can keep the public complaint
       anonymous even if the backend requires
       an internal user record.

       We only send fields that the current
       backend form provides.
    */

    if (
        !reporter.name &&
        !reporter.email &&
        !reporter.phone
    ) {
        return null;
    }

    const payload = {};

    if (reporter.name) {
        payload.name =
            reporter.name;
    }

    if (reporter.email) {
        payload.email =
            reporter.email;
    }

    if (reporter.phone) {
        payload.phone =
            reporter.phone;
    }

    try {
        return await fetchJSON(
            "/users",
            {
                method: "POST",

                headers: {
                    "Content-Type":
                        "application/json"
                },

                body:
                    JSON.stringify(
                        payload
                    )
            }
        );
    }
    catch (error) {
        console.warn(
            "Could not create reporter:",
            error
        );

        /*
           Some backend versions do not require
           a separate reporter record. Complaint
           submission should still be attempted.
        */

        return null;
    }
}


function buildComplaintPayload(
    reporter
) {
    const city =
        document.getElementById(
            "city"
        );

    const category =
        document.getElementById(
            "category"
        );

    const department =
        document.getElementById(
            "department"
        );

    const description =
        document.getElementById(
            "description"
        );

    const priority =
        document.getElementById(
            "priority"
        );

    const payload = {
        city_id:
            Number(
                city?.value
            ),

        category_id:
            Number(
                category?.value
            ),

        department_id:
            Number(
                department?.value
            ),

        location:
            locationPayloadFromForm(),

        description:
            description?.value
                ?.trim()
            || "",

        priority:
            priority?.value ||
            "Normal"
    };

    /*
       Preserve compatibility with backend
       versions that return user_id/id from
       POST /users.
    */

    const reporterId =
        reporter?.user_id ??
        reporter?.id ??
        null;

    if (
        reporterId !== null
    ) {
        payload.user_id =
            Number(reporterId);
    }

    return payload;
}


function validateComplaintPayload(
    payload
) {
    if (
        !Number.isFinite(
            payload.city_id
        )
    ) {
        return "Select a city.";
    }

    if (
        !Number.isFinite(
            payload.category_id
        )
    ) {
        return "Select a problem category.";
    }

    if (
        !Number.isFinite(
            payload.department_id
        )
    ) {
        return "Select the responsible department.";
    }

    if (
        !payload.location
    ) {
        return "Enter the problem location.";
    }

    if (
        !payload.description
    ) {
        return "Describe the civic problem.";
    }

    return "";
}


function resetComplaintForm() {
    const form =
        document.getElementById(
            "complaintForm"
        );

    form?.reset();

    clearReportPin();

    const preview =
        document.getElementById(
            "evidencePreview"
        );

    if (preview) {
        preview.innerHTML = `
            <span class="evidence-empty">
                No evidence selected.
            </span>
        `;
    }

    const message =
        document.getElementById(
            "locationMessage"
        );

    if (message) {
        message.textContent = "";
    }
}


function showSubmissionSuccess(
    complaint
) {
    const result =
        document.getElementById(
            "submissionResult"
        );

    if (!result) {
        showToast(
            `Record ${formatComplaintId(
                complaint.complaint_id
            )} created.`
        );

        return;
    }

    result.innerHTML = `
        <div class="submission-success">

            <span class="submission-success-kicker">
                PUBLIC RECORD CREATED
            </span>

            <strong>
                ${escapeHTML(
                    formatComplaintId(
                        complaint.complaint_id
                    )
                )}
            </strong>

            <p>
                This complaint is now part of
                CITYFILE's public civic record.
                Its progress can be tracked from
                report to citizen verification.
            </p>

            <div class="submission-success-actions">

                <button
                    type="button"
                    data-track-new-record
                >
                    TRACK THIS RECORD →
                </button>

                <button
                    type="button"
                    data-open-new-record
                >
                    OPEN FULL RECORD
                </button>

            </div>

        </div>
    `;

    result
        .querySelector(
            "[data-track-new-record]"
        )
        ?.addEventListener(
            "click",
            () => {
                const trackInput =
                    document.getElementById(
                        "trackId"
                    );

                if (trackInput) {
                    trackInput.value =
                        formatComplaintId(
                            complaint.complaint_id
                        );
                }

                showView(
                    "track"
                );

                setTimeout(
                    trackComplaint,
                    100
                );
            }
        );

    result
        .querySelector(
            "[data-open-new-record]"
        )
        ?.addEventListener(
            "click",
            () => {
                openCase(
                    complaint.complaint_id
                );
            }
        );
}


async function submitComplaint(
    event
) {
    event.preventDefault();

    const submitButton =
        event.currentTarget
            ?.querySelector(
                '[type="submit"]'
            );

    if (submitButton) {
        submitButton.disabled =
            true;

        submitButton.dataset
            .originalText =
            submitButton.textContent;

        submitButton.textContent =
            "CREATING PUBLIC RECORD…";
    }

    try {
        const reporter =
            await createReporterIfNeeded();

        const payload =
            buildComplaintPayload(
                reporter
            );

        const validationError =
            validateComplaintPayload(
                payload
            );

        if (validationError) {
            showToast(
                validationError
            );

            return;
        }

        const complaint =
            await fetchJSON(
                "/complaints",
                {
                    method: "POST",

                    headers: {
                        "Content-Type":
                            "application/json"
                    },

                    body:
                        JSON.stringify(
                            payload
                        )
                }
            );

        if (
            complaint?.complaint_id !==
            undefined
        ) {
            saveMyComplaintId(
                complaint.complaint_id
            );
        }

        resetComplaintForm();

        showSubmissionSuccess(
            complaint
        );

        await loadComplaints({
            silent: true
        });
    }
    catch (error) {
        console.error(
            "Complaint submission error:",
            error
        );

        showToast(
            error.message ||
            "Could not create the complaint record."
        );
    }
    finally {
        if (submitButton) {
            submitButton.disabled =
                false;

            submitButton.textContent =
                submitButton.dataset
                    .originalText ||
                "CREATE PUBLIC RECORD";
        }
    }
}


function initializeComplaintForm() {
    document
        .getElementById(
            "complaintForm"
        )
        ?.addEventListener(
            "submit",
            submitComplaint
        );

    document
        .getElementById(
            "useMyLocation"
        )
        ?.addEventListener(
            "click",
            getLocation
        );

    document
        .getElementById(
            "clearReportPin"
        )
        ?.addEventListener(
            "click",
            clearReportPin
        );
}


/* ============================================================
   TRACK — RECORD JOURNEY
   ============================================================ */

function parseComplaintId(value) {
    const cleaned =
        String(value || "")
            .trim()
            .toUpperCase()
            .replace(
                /^CC-/,
                ""
            );

    const id =
        Number.parseInt(
            cleaned,
            10
        );

    return Number.isFinite(id)
        ? id
        : null;
}

async function trackComplaint() {
    const input = document.getElementById("trackId");
    const result = document.getElementById("trackingResult");

    if (!input || !result) {
        return;
    }

    const id = parseComplaintId(input.value);

    if (id === null) {
        result.innerHTML = `
            <div class="tracking-error tracking-error-redesign">
                <small>INVALID RECORD ID</small>

                <strong>
                    Use a CITYFILE record such as CC-000123.
                </strong>
            </div>
        `;

        return;
    }


    /* ---------------------------------------------------------
       LOADING
       --------------------------------------------------------- */

    result.innerHTML = `
        <div class="tracking-loading">
            <span></span>
            READING PUBLIC RECORD…
        </div>
    `;


    try {

        /* -----------------------------------------------------
           EXISTING BACKEND LOGIC — UNCHANGED
           ----------------------------------------------------- */

        const complaint = await fetchJSON(
            `/complaints/${id}`
        );

        const states = lifecycleStates(complaint);

        const verified = isVerified(complaint);

        const authorityResolved =
            isAuthorityResolved(complaint);

        const age =
            verified
                ? "CLOSED / VERIFIED"
                : formatDuration(
                    complaintAgeMs(complaint)
                );


        /* -----------------------------------------------------
           SCROLL RECORD
           ----------------------------------------------------- */

        result.innerHTML = `

            <article
                class="civic-scroll"
                id="civicTrackingScroll"
            >

                <!-- TOP OF SCROLL -->

                <div
                    class="scroll-roller scroll-roller-top"
                    aria-hidden="true"
                >
                    <span></span>
                </div>


                <div class="scroll-paper">


                    <!-- =======================================
                         RECORD HEADER
                         ======================================= -->

                    <header class="scroll-record-header">

                        <span class="scroll-record-kicker">
                            CITYFILE / PUBLIC CIVIC RECORD
                        </span>

                        <span class="scroll-record-id">

                            ${escapeHTML(
                                formatComplaintId(
                                    complaint.complaint_id
                                )
                            )}

                        </span>


                        <h3>

                            ${escapeHTML(
                                getCategoryName(
                                    complaint
                                )
                            )}

                        </h3>


                        <p class="scroll-location">

                            ${escapeHTML(
                                publicLocation(
                                    complaint
                                )
                            )}

                        </p>


                        <div class="scroll-current-state">

                            <small>
                                CURRENT STATE
                            </small>

                            <strong>

                                ${escapeHTML(
                                    homeStatusLabel(
                                        complaint
                                    )
                                )}

                            </strong>

                            <span>
                                ${escapeHTML(age)}
                            </span>

                        </div>

                    </header>



                    <!-- =======================================
                         INTRODUCTION
                         ======================================= -->

                    <section class="scroll-introduction">

                        <span class="scroll-chapter-number">
                            THE RECORD BEGINS
                        </span>

                        <h4>
                            A PROBLEM ENTERED THE CITY'S MEMORY.
                        </h4>

                        <p>
                            What happened after this complaint
                            was reported remains part of the
                            public record. Break each seal to
                            follow its history.
                        </p>

                        <span class="scroll-created-date">

                            ${escapeHTML(
                                formatDate(
                                    complaint.created_at
                                )
                            )}

                        </span>

                    </section>



                    <!-- =======================================
                         UNFOLDING CIVIC EVENTS
                         ======================================= -->

                    <div class="scroll-unfolding-record">

                        ${
                            states.map(
                                (step, index) => {

                                    const descriptions = [

                                        "Complaint entered the public record.",

                                        step.state === "waiting"
                                            ? "No acknowledgement has been recorded yet."
                                            : "The complaint has been acknowledged in the civic process.",

                                        step.state === "waiting"
                                            ? "No action has been recorded yet."
                                            : "The record shows that action has begun or been completed.",

                                        step.state === "waiting"
                                            ? "The authority has not recorded a completed fix."
                                            : "The authority has recorded the problem as fixed.",

                                        step.state === "complete"
                                            ? "Citizen verification closed the accountability loop."
                                            : authorityResolved
                                                ? "The city says the problem is fixed. Citizen verification is still required."
                                                : "Citizen verification only begins after the authority records a fix."
                                    ];


                                    const timestamp =
                                        index === 0

                                            ? formatDate(
                                                complaint.created_at
                                            )

                                            : step.state === "waiting"

                                                ? "RECORD ABSENT"

                                                : "RECORDED";


                                    return `


                                        <!-- ===================
                                             WAX SEAL
                                             =================== -->

                                        ${
                                            index > 0

                                                ? `

                                                    <div
                                                        class="scroll-seal-gate"
                                                        data-scroll-gate="${index}"
                                                    >

                                                        <div
                                                            class="seal-thread"
                                                            aria-hidden="true"
                                                        ></div>


                                                        <button
                                                            type="button"
                                                            class="wax-seal"
                                                            data-unfold-scroll="${index}"
                                                            aria-label="Unfold the next part of this civic record"
                                                        >

                                                            <span
                                                                class="wax-seal-inner"
                                                            >

                                                                <span
                                                                    class="wax-plus"
                                                                >
                                                                    +
                                                                </span>

                                                            </span>

                                                        </button>


                                                        <span
                                                            class="seal-instruction"
                                                        >
                                                            BREAK SEAL TO UNFOLD
                                                        </span>

                                                    </div>

                                                `

                                                : ""
                                        }



                                        <!-- ===================
                                             RECORD SECTION
                                             =================== -->

                                        <section
                                            class="
                                                scroll-record-section
                                                ${index === 0
                                                    ? "is-revealed"
                                                    : ""
                                                }
                                                ${step.state}
                                            "
                                            data-scroll-section="${index}"
                                        >


                                            <div
                                                class="scroll-section-heading"
                                            >

                                                <span>
                                                    0${index + 1}
                                                </span>


                                                <div>

                                                    <small>
                                                        CIVIC EVENT
                                                    </small>

                                                    <h4>

                                                        ${escapeHTML(
                                                            step.label
                                                        )}

                                                    </h4>

                                                </div>

                                            </div>



                                            <div
                                                class="scroll-section-mark"
                                            >

                                                <span
                                                    class="
                                                        scroll-event-symbol
                                                        ${step.state}
                                                    "
                                                >

                                                    ${
                                                        step.state === "complete"

                                                            ? "✓"

                                                            : step.state === "current"

                                                                ? "•"

                                                                : "○"
                                                    }

                                                </span>


                                                <div
                                                    class="scroll-event-line"
                                                ></div>

                                            </div>



                                            <p
                                                class="scroll-event-description"
                                            >

                                                ${escapeHTML(
                                                    descriptions[index]
                                                )}

                                            </p>



                                            <div
                                                class="scroll-event-meta"
                                            >

                                                <span>

                                                    ${escapeHTML(
                                                        timestamp
                                                    )}

                                                </span>


                                                ${
                                                    index === 1

                                                        ? `

                                                            <span>

                                                                RESPONSIBLE /
                                                                ${escapeHTML(
                                                                    getDepartmentName(
                                                                        complaint
                                                                    )
                                                                )}

                                                            </span>

                                                        `

                                                        : ""
                                                }

                                            </div>



                                            ${
                                                step.state === "current"

                                                    ? `

                                                        <div
                                                            class="scroll-you-are-here"
                                                        >
                                                            THE RECORD CURRENTLY STOPS HERE
                                                        </div>

                                                    `

                                                    : ""
                                            }


                                        </section>

                                    `;
                                }
                            ).join("")
                        }

                    </div>



                    <!-- =======================================
                         FINAL WAX SEAL
                         ======================================= -->

                    <div
                        class="scroll-final-gate"
                        id="scrollFinalGate"
                    >

                        <div
                            class="seal-thread"
                            aria-hidden="true"
                        ></div>


                        <button
                            type="button"
                            class="wax-seal wax-seal-final"
                            id="unfoldCompleteRecord"
                            aria-label="Unseal the complete civic record"
                        >

                            <span class="wax-seal-inner">

                                <span class="wax-plus">
                                    +
                                </span>

                            </span>

                        </button>


                        <span class="seal-instruction">
                            UNSEAL COMPLETE RECORD
                        </span>

                    </div>



                    <!-- =======================================
                         COMPLETE RECORD
                         ======================================= -->

                    <section
                        class="scroll-complete-record"
                        id="scrollCompleteRecord"
                    >

                        <small>
                            COMPLETE CIVIC RECORD
                        </small>


                        <h4>

                            ${escapeHTML(
                                formatComplaintId(
                                    complaint.complaint_id
                                )
                            )}

                        </h4>



                        <div class="complete-record-status">


                            <span>

                                <small>
                                    STATUS
                                </small>

                                ${escapeHTML(
                                    homeStatusLabel(
                                        complaint
                                    )
                                )}

                            </span>



                            <span>

                                <small>
                                    RECORD AGE
                                </small>

                                ${escapeHTML(age)}

                            </span>



                            <span>

                                <small>
                                    RESPONSIBLE
                                </small>

                                ${escapeHTML(
                                    getDepartmentName(
                                        complaint
                                    )
                                )}

                            </span>



                            <span>

                                <small>
                                    PRIORITY
                                </small>

                                ${escapeHTML(
                                    complaint.priority ||
                                    "NOT RECORDED"
                                )}

                            </span>


                        </div>



                        <!-- AUTHORITY RESOLVED BUT
                             CITIZENS HAVE NOT VERIFIED -->

                        ${
                            authorityResolved &&
                            !verified

                                ? `

                                    <div
                                        class="scroll-verification-warning"
                                    >

                                        <span>
                                            CITY SAYS
                                        </span>

                                        <strong>
                                            FIXED.
                                        </strong>


                                        <p>
                                            The authority-side record
                                            says this problem is resolved.
                                            CITYFILE does not treat that
                                            as final closure until citizens
                                            verify the real-world fix.
                                        </p>


                                        <div>

                                            MARKED RESOLVED

                                            <b>≠</b>

                                            CITIZEN VERIFIED

                                        </div>


                                        <div
                                            class="verification-placeholder-actions"
                                        >

                                            <button
                                                type="button"
                                                data-verification-info
                                            >
                                                YES ✓
                                            </button>

                                            <button
                                                type="button"
                                                data-verification-info
                                            >
                                                NO ✕
                                            </button>

                                        </div>

                                    </div>

                                `

                                : ""
                        }



                        <!-- VERIFIED RECORD -->

                        ${
                            verified

                                ? `

                                    <div
                                        class="scroll-verified"
                                    >

                                        <small>
                                            ACCOUNTABILITY LOOP CLOSED
                                        </small>

                                        <strong>
                                            CITIZEN VERIFIED ✓
                                        </strong>

                                        <p>
                                            The fix passed the final
                                            verification stage. The
                                            record remains publicly
                                            inspectable.
                                        </p>

                                    </div>

                                `

                                : ""
                        }



                        <button
                            type="button"
                            class="
                                open-file-btn
                                scroll-open-file
                            "
                            id="trackingOpenFile"
                        >
                            OPEN FULL RECORD →
                        </button>


                    </section>


                </div>



                <!-- BOTTOM OF SCROLL -->

                <div
                    class="
                        scroll-roller
                        scroll-roller-bottom
                    "
                    aria-hidden="true"
                >
                    <span></span>
                </div>


            </article>

        `;



        /* =====================================================
           OPEN FULL RECORD
           Existing functionality preserved.
           ===================================================== */

        document
            .getElementById(
                "trackingOpenFile"
            )
            ?.addEventListener(
                "click",
                () => {

                    openCase(
                        complaint.complaint_id
                    );

                }
            );



        /* =====================================================
           WAX-SEAL UNFOLDING
           This affects presentation only.
           ===================================================== */

        const scrollGates =
            result.querySelectorAll(
                "[data-scroll-gate]"
            );


        scrollGates.forEach(
            gate => {

                const button =
                    gate.querySelector(
                        "[data-unfold-scroll]"
                    );


                if (!button) {
                    return;
                }


                button.addEventListener(
                    "click",
                    () => {

                        const sectionIndex =
                            Number(
                                button.dataset
                                    .unfoldScroll
                            );


                        const nextSection =
                            result.querySelector(
                                `[data-scroll-section="${sectionIndex}"]`
                            );


                        if (!nextSection) {
                            return;
                        }



                        /* BREAK THE CURRENT SEAL */

                        button.classList.add(
                            "is-broken"
                        );

                        gate.classList.add(
                            "is-opened"
                        );



                        /* UNFOLD NEXT SECTION */

                        nextSection.classList.add(
                            "is-revealed"
                        );



                        /* MAKE NEXT SEAL AVAILABLE */

                        const nextGate =
                            result.querySelector(
                                `[data-scroll-gate="${sectionIndex + 1}"]`
                            );


                        if (nextGate) {

                            nextGate.classList.add(
                                "is-available"
                            );

                        }

                        else {

                            document
                                .getElementById(
                                    "scrollFinalGate"
                                )
                                ?.classList.add(
                                    "is-available"
                                );

                        }



                        /* FOLLOW THE SCROLL */

                        setTimeout(
                            () => {

                                nextSection
                                    .scrollIntoView({
                                        behavior:
                                            "smooth",

                                        block:
                                            "center"
                                    });

                            },
                            350
                        );

                    }
                );

            }
        );



        /* =====================================================
           MAKE FIRST SEAL VISIBLE
           ===================================================== */

        result
            .querySelector(
                '[data-scroll-gate="1"]'
            )
            ?.classList.add(
                "is-available"
            );



        /* =====================================================
           FINAL SEAL
           ===================================================== */

        document
            .getElementById(
                "unfoldCompleteRecord"
            )
            ?.addEventListener(
                "click",
                event => {

                    const seal =
                        event.currentTarget;


                    const completeRecord =
                        document
                            .getElementById(
                                "scrollCompleteRecord"
                            );


                    seal.classList.add(
                        "is-broken"
                    );


                    document
                        .getElementById(
                            "scrollFinalGate"
                        )
                        ?.classList.add(
                            "is-opened"
                        );


                    completeRecord
                        ?.classList.add(
                            "is-revealed"
                        );


                    setTimeout(
                        () => {

                            completeRecord
                                ?.scrollIntoView({
                                    behavior:
                                        "smooth",

                                    block:
                                        "center"
                                });

                        },
                        400
                    );

                }
            );



        /* =====================================================
           EXISTING CITIZEN VERIFICATION PLACEHOLDER
           ===================================================== */

        result
            .querySelectorAll(
                "[data-verification-info]"
            )
            .forEach(
                button => {

                    button.addEventListener(
                        "click",
                        () => {

                            showToast(
                                "Citizen verification needs a backend verification endpoint before it can change the record."
                            );

                        }
                    );

                }
            );



        /* =====================================================
           EXISTING LOCAL COMPLAINT CACHE
           ===================================================== */

        if (
            !allComplaints.some(
                item =>
                    Number(
                        item.complaint_id
                    )
                    ===
                    Number(
                        complaint.complaint_id
                    )
            )
        ) {

            allComplaints.push(
                complaint
            );

        }

    }

    catch (error) {

        result.innerHTML = `

            <div
                class="
                    tracking-error
                    tracking-error-redesign
                "
            >

                <small>
                    RECORD NOT FOUND
                </small>


                <strong>

                    ${escapeHTML(
                        error.message ||
                        "Problem File not found."
                    )}

                </strong>


                <p>
                    Check the CITYFILE ID
                    and try again.
                </p>

            </div>

        `;

    }
}

function initializeTracking() {
    document
        .getElementById(
            "trackButton"
        )
        ?.addEventListener(
            "click",
            trackComplaint
        );

    document
        .getElementById(
            "trackId"
        )
        ?.addEventListener(
            "keydown",
            event => {
                if (
                    event.key ===
                    "Enter"
                ) {
                    event.preventDefault();

                    trackComplaint();
                }
            }
        );
}


/* ============================================================
   YOUR FILES — CIVIC FOOTPRINT
   ============================================================ */

function getMyComplaintIds() {
    try {
        const parsed =
            JSON.parse(
                localStorage.getItem(
                    "cityfile_my_complaints"
                ) || "[]"
            );

        return Array.isArray(
            parsed
        )
            ? parsed.map(String)
            : [];
    }
    catch {
        return [];
    }
}


function getMyComplaints() {
    const savedIds =
        getMyComplaintIds();

    return allComplaints
        .filter(
            complaint =>
                savedIds.includes(
                    String(
                        complaint.complaint_id
                    )
                )
        )
        .sort(
            (a, b) =>
                (
                    Date.parse(
                        b.created_at || ""
                    ) || 0
                )
                -
                (
                    Date.parse(
                        a.created_at || ""
                    ) || 0
                )
        );
}


function profileRecordStatus(
    complaint
) {
    if (
        isVerified(
            complaint
        )
    ) {
        return "fixed";
    }

    if (
        isAuthorityResolved(
            complaint
        )
    ) {
        return "needs-you";
    }

    return "active";
}


function renderProfileFiles() {
    const grid =
        document.getElementById(
            "profileGrid"
        );

    const detail =
        document.getElementById(
            "footprintDetail"
        );

    if (!grid) {
        return;
    }

    const myComplaints =
        getMyComplaints();

    const counts = {
        profileTotalCount:
            myComplaints.length,

        profileActiveCount:
            myComplaints.filter(
                complaint =>
                    !isVerified(
                        complaint
                    )
                    &&
                    !isAuthorityResolved(
                        complaint
                    )
            ).length,

        profileVerifyCount:
            myComplaints.filter(
                complaint =>
                    isAuthorityResolved(
                        complaint
                    )
                    &&
                    !isVerified(
                        complaint
                    )
            ).length,

        profileVerifiedCount:
            myComplaints.filter(
                isVerified
            ).length
    };

    Object.entries(
        counts
    ).forEach(
        ([id, value]) => {
            const element =
                document.getElementById(
                    id
                );

            if (element) {
                element.textContent =
                    value;
            }
        }
    );

    grid.innerHTML = "";

    if (detail) {
        detail.hidden = true;
        detail.innerHTML = "";
    }

    if (!myComplaints.length) {
        grid.innerHTML = `
            <div
                class="semantic-empty profile-empty"
                style="grid-column:1/-1"
            >

                <strong>
                    NO FOOTPRINTS YET.
                </strong>

                <p>
                    Your first submitted complaint
                    will leave the first mark in
                    your civic footprint.
                </p>

                <button
                    type="button"
                    data-view="report"
                >
                    + REPORT A PROBLEM
                </button>

            </div>
        `;

        return;
    }

    /*
       The central YOU node is deliberately
       created in JavaScript so the existing
       profileGrid HTML hook can remain intact.
    */

    const origin =
        document.createElement(
            "div"
        );

    origin.className =
        "civic-footprint-origin";

    origin.innerHTML = `
        <span>
            YOU
        </span>

        <strong>
            ●
        </strong>

        <small>
            ${
                myComplaints.length
            }
            ${
                myComplaints.length === 1
                    ? "RECORD"
                    : "RECORDS"
            }
            SET IN MOTION
        </small>
    `;

    grid.appendChild(
        origin
    );

    myComplaints.forEach(
        (
            complaint,
            index
        ) => {
            const button =
                document.createElement(
                    "button"
                );

            button.type =
                "button";

            const state =
                profileRecordStatus(
                    complaint
                );

            button.className =
                `footprint-record ${state}`;

            button.style
                .setProperty(
                    "--footprint-index",
                    index
                );

            button.innerHTML = `

                <span
                    class="footprint-branch"
                    aria-hidden="true"
                >
                </span>

                <span
                    class="footprint-shape"
                    aria-hidden="true"
                >
                    <i class="footprint-toe t1"></i>
                    <i class="footprint-toe t2"></i>
                    <i class="footprint-toe t3"></i>
                    <i class="footprint-toe t4"></i>
                    <i class="footprint-sole"></i>
                </span>

                <span class="footprint-id">

                    <strong>
                        ${escapeHTML(
                            formatComplaintId(
                                complaint.complaint_id
                            )
                        )}
                    </strong>

                    <span>
                        ${escapeHTML(
                            homeStatusLabel(
                                complaint
                            )
                        )}
                    </span>

                    <small>
                        ${escapeHTML(
                            getCategoryName(
                                complaint
                            )
                        )}
                    </small>

                </span>

                ${
                    state ===
                    "needs-you"

                        ? `
                            <em>
                                NEEDS YOU
                            </em>
                        `

                        : ""
                }
            `;

            button.addEventListener(
                "click",
                () => {
                    grid
                        .querySelectorAll(
                            ".footprint-record"
                        )
                        .forEach(
                            item => {
                                item.classList.remove(
                                    "active"
                                );
                            }
                        );

                    button.classList.add(
                        "active"
                    );

                    renderFootprintDetail(
                        complaint
                    );
                }
            );

            grid.appendChild(
                button
            );
        }
    );

    /*
       If one record requires verification,
       visually prioritize it by opening it.
    */

    const needsUser =
        myComplaints.find(
            complaint =>
                isAuthorityResolved(
                    complaint
                )
                &&
                !isVerified(
                    complaint
                )
        );

    if (needsUser) {
        const index =
            myComplaints.indexOf(
                needsUser
            );

        const buttons =
            grid.querySelectorAll(
                ".footprint-record"
            );

        buttons[
            index
        ]?.classList.add(
            "attention"
        );
    }
}


function renderFootprintDetail(
    complaint
) {
    const detail =
        document.getElementById(
            "footprintDetail"
        );

    if (!detail) {
        openCase(
            complaint.complaint_id
        );

        return;
    }

    const needsVerification =
        isAuthorityResolved(
            complaint
        )
        &&
        !isVerified(
            complaint
        );

    detail.hidden = false;

    detail.innerHTML = `

        <div class="footprint-detail-head">

            <div>

                <small>
                    ${escapeHTML(
                        formatComplaintId(
                            complaint.complaint_id
                        )
                    )}
                </small>

                <h4>
                    ${escapeHTML(
                        getCategoryName(
                            complaint
                        )
                    )}
                </h4>

            </div>

            <span class="footprint-detail-status">
                ${escapeHTML(
                    homeStatusLabel(
                        complaint
                    )
                )}
            </span>

        </div>


        ${
            needsVerification

                ? `
                    <div
                        class="footprint-needs-you"
                    >

                        <small>
                            ONE FILE NEEDS YOU
                        </small>

                        <strong>
                            CITY SAYS: FIXED
                        </strong>

                        <p>
                            The authority has marked
                            this problem resolved.
                            Your verification is the
                            final accountability step.
                        </p>

                        <div
                            class="footprint-user-verdict"
                        >
                            <span>
                                YOU SAY:
                            </span>

                            <strong>
                                ________
                            </strong>
                        </div>

                        <div
                            class="footprint-verification-actions"
                        >

                            <button
                                type="button"
                                data-profile-verification
                            >
                                VERIFY ✓
                            </button>

                            <button
                                type="button"
                                data-profile-verification
                            >
                                STILL BROKEN ✕
                            </button>

                        </div>

                    </div>
                `

                : ""
        }


        <div class="footprint-detail-body">

            <div
                class="footprint-detail-description"
            >

                <small>
                    YOUR COMPLAINT
                </small>

                <p>
                    ${escapeHTML(
                        complaint.description ||
                        "No description recorded."
                    )}
                </p>

            </div>

            <div
                class="footprint-detail-meta"
            >

                <div>

                    <small>
                        LOCATION
                    </small>

                    <strong>
                        ${escapeHTML(
                            publicLocation(
                                complaint
                            )
                        )}
                    </strong>

                </div>

                <div>

                    <small>
                        RESPONSIBLE
                    </small>

                    <strong>
                        ${escapeHTML(
                            getDepartmentName(
                                complaint
                            )
                        )}
                    </strong>

                </div>

                <div>

                    <small>
                        SUBMITTED
                    </small>

                    <strong>
                        ${escapeHTML(
                            formatDate(
                                complaint.created_at
                            )
                        )}
                    </strong>

                </div>

            </div>

        </div>


        <div class="footprint-detail-actions">

            <button
                type="button"
                class="open-file-btn"
                id="footprintOpenFull"
            >
               
            </button>

        </div>
    `;

    detail
        .querySelector(
            "#footprintOpenFull"
        )
        ?.addEventListener(
            "click",
            () => {
                openCase(
                    complaint.complaint_id
                );
            }
        );

    detail
        .querySelectorAll(
            "[data-profile-verification]"
        )
        .forEach(
            button => {
                button.addEventListener(
                    "click",
                    () => {
                        showToast(
                            "Citizen verification needs a backend verification endpoint before it can change the public record."
                        );
                    }
                );
            }
        );

    detail.scrollIntoView({
        behavior: "smooth",
        block: "nearest"
    });
}/* ============================================================
   CASE OVERLAY — FULL PUBLIC RECORD
   ============================================================ */

function statusExplanation(complaint) {
    if (isVerified(complaint)) {
        return (
            "Citizens verified the real-world fix. " +
            "The accountability loop is closed, but the record remains public."
        );
    }

    if (isAuthorityResolved(complaint)) {
        return (
            "The responsible authority has marked this problem resolved. " +
            "Citizen verification is still required before CITYFILE treats the file as closed."
        );
    }

    if (isInProgress(complaint)) {
        return (
            "The complaint has moved beyond submission and action is recorded as underway."
        );
    }

    return (
        "The complaint is on the public record and is still awaiting meaningful authority action."
    );
}


function blockchainStateMarkup(complaint) {
    const hash =
        getBlockchainHash(
            complaint
        );

    if (!hash) {
        return `
            <div class="case-chain-state pending">

                <span class="case-chain-icon">
                    ○
                </span>

                <div>
                    <small>
                        PUBLIC CHAIN
                    </small>

                    <strong>
                        NOT ANCHORED YET
                    </strong>

                    <p>
                        No blockchain transaction hash
                        is present in the current backend
                        record.
                    </p>
                </div>

            </div>
        `;
    }

    return `
        <div class="case-chain-state anchored">

            <span class="case-chain-icon">
                ✓
            </span>

            <div>
                <small>
                    PUBLIC CHAIN
                </small>

                <strong>
                    RECORD ANCHORED
                </strong>

                <code>
                    ${escapeHTML(hash)}
                </code>
            </div>

        </div>
    `;
}


function caseTimelineMarkup(
    complaint
) {
    const states =
        lifecycleStates(
            complaint
        );

    const descriptions = [
        "Complaint entered CITYFILE's public record.",
        "Authority acknowledgement stage.",
        "Recorded action stage.",
        "Authority-side resolution stage.",
        "Citizen verification stage."
    ];

    return `
        <div class="case-timeline">

            ${states.map(
                (
                    step,
                    index
                ) => `
                    <div
                        class="case-timeline-step
                        ${step.state}"
                    >

                        <span
                            class="case-timeline-node"
                        >
                        </span>

                        <div>

                            <small>
                                0${index + 1}
                            </small>

                            <strong>
                                ${escapeHTML(
                                    step.label
                                )}
                            </strong>

                            <p>
                                ${escapeHTML(
                                    descriptions[
                                        index
                                    ]
                                )}
                            </p>

                        </div>

                    </div>
                `
            ).join("")}

        </div>
    `;
}


async function openCase(
    complaintId
) {
    const overlay =
        document.getElementById(
            "caseOverlay"
        );

    const body =
        document.getElementById(
            "caseOverlayBody"
        );

    if (
        !overlay ||
        !body
    ) {
        return;
    }

    overlay.hidden = false;

    document.body.classList.add(
        "case-open"
    );

    body.innerHTML = `
        <div class="case-loading">
            READING PUBLIC RECORD…
        </div>
    `;

    try {
        let complaint =
            allComplaints.find(
                item =>
                    Number(
                        item.complaint_id
                    )
                    ===
                    Number(
                        complaintId
                    )
            );

        /*
           Fetch the individual complaint so
           the drawer can show the freshest
           backend version.
        */

        try {
            complaint =
                await fetchJSON(
                    `/complaints/${Number(
                        complaintId
                    )}`
                );
        }
        catch (error) {
            if (!complaint) {
                throw error;
            }
        }

        if (!complaint) {
            throw new Error(
                "Problem File not found."
            );
        }

        const hash =
            getBlockchainHash(
                complaint
            );

        const verified =
            isVerified(
                complaint
            );

        const authorityResolved =
            isAuthorityResolved(
                complaint
            );

        body.innerHTML = `

            <article class="case-record">

                <header class="case-record-header">

                    <div>

                        <span class="case-record-kicker">
                            PUBLIC CIVIC RECORD
                        </span>

                        <strong class="case-record-id">
                            ${escapeHTML(
                                formatComplaintId(
                                    complaint.complaint_id
                                )
                            )}
                        </strong>

                    </div>

                    <span
                        class="case-record-status
                        ${bookStatusClass(
                            complaint
                        )}"
                    >
                        ${escapeHTML(
                            homeStatusLabel(
                                complaint
                            )
                        )}
                    </span>

                </header>


                <section class="case-record-intro">

                    <small>
                        ${escapeHTML(
                            getCategoryName(
                                complaint
                            )
                        )}
                    </small>

                    <h2>
                        ${escapeHTML(
                            publicLocation(
                                complaint
                            )
                        )}
                    </h2>

                    <p>
                        ${escapeHTML(
                            complaint.description ||
                            "No description recorded."
                        )}
                    </p>

                </section>


                <section class="case-record-metadata">

                    <div>

                        <small>
                            RESPONSIBLE
                        </small>

                        <strong>
                            ${escapeHTML(
                                getDepartmentName(
                                    complaint
                                )
                            )}
                        </strong>

                    </div>

                    <div>

                        <small>
                            CITY
                        </small>

                        <strong>
                            ${escapeHTML(
                                getCityName(
                                    complaint
                                )
                            )}
                        </strong>

                    </div>

                    <div>

                        <small>
                            SUBMITTED
                        </small>

                        <strong>
                            ${escapeHTML(
                                formatDate(
                                    complaint.created_at
                                )
                            )}
                        </strong>

                    </div>

                    <div>

                        <small>
                            PRIORITY
                        </small>

                        <strong>
                            ${escapeHTML(
                                complaint.priority ||
                                "NOT RECORDED"
                            )}
                        </strong>

                    </div>

                </section>


                <section class="case-record-section">

                    <div class="case-section-heading">

                        <small>
                            ACCOUNTABILITY
                        </small>

                        <h3>
                            What happened after
                            the report?
                        </h3>

                    </div>

                    ${
                        caseTimelineMarkup(
                            complaint
                        )
                    }

                </section>


                <section class="case-record-section">

                    <div class="case-section-heading">

                        <small>
                            CURRENT MEANING
                        </small>

                        <h3>
                            ${
                                escapeHTML(
                                    homeStatusLabel(
                                        complaint
                                    )
                                )
                            }
                        </h3>

                    </div>

                    <p class="case-status-explanation">
                        ${escapeHTML(
                            statusExplanation(
                                complaint
                            )
                        )}
                    </p>

                </section>


                ${
                    authorityResolved &&
                    !verified

                        ? `
                            <section
                                class="case-verification-warning"
                            >

                                <small>
                                    IMPORTANT
                                </small>

                                <strong>
                                    MARKED RESOLVED
                                    ≠
                                    CITIZEN VERIFIED
                                </strong>

                                <p>
                                    An authority-side resolution
                                    does not automatically close
                                    the civic record.
                                </p>

                            </section>
                        `

                        : ""
                }


                <section class="case-record-section">

                    <div class="case-section-heading">

                        <small>
                            INTEGRITY
                        </small>

                        <h3>
                            Public-chain state
                        </h3>

                    </div>

                    ${
                        blockchainStateMarkup(
                            complaint
                        )
                    }

                </section>


                ${
                    hash

                        ? `
                            <section class="case-hash-block">

                                <small>
                                    TRANSACTION HASH
                                </small>

                                <code>
                                    ${escapeHTML(hash)}
                                </code>

                            </section>
                        `

                        : ""
                }


                <footer class="case-record-footer">

                    <span>
                        ${
                            verified
                                ? "RECORD CLOSED · REMAINS PUBLIC"
                                : "PUBLIC RECORD REMAINS OPEN"
                        }
                    </span>

                    <button
                        type="button"
                        id="caseTrackButton"
                    >
                        TRACK THIS FILE →
                    </button>

                </footer>

            </article>
        `;

        document
            .getElementById(
                "caseTrackButton"
            )
            ?.addEventListener(
                "click",
                () => {
                    closeCaseOverlay();

                    const input =
                        document.getElementById(
                            "trackId"
                        );

                    if (input) {
                        input.value =
                            formatComplaintId(
                                complaint.complaint_id
                            );
                    }

                    showView(
                        "track"
                    );

                    setTimeout(
                        trackComplaint,
                        100
                    );
                }
            );
    }
    catch (error) {
        body.innerHTML = `
            <div class="case-error">

                <small>
                    RECORD UNAVAILABLE
                </small>

                <strong>
                    ${escapeHTML(
                        error.message ||
                        "Could not open this public record."
                    )}
                </strong>

            </div>
        `;
    }
}


function closeCaseOverlay() {
    const overlay =
        document.getElementById(
            "caseOverlay"
        );

    if (overlay) {
        overlay.hidden = true;
    }

    document.body.classList.remove(
        "case-open"
    );
}


function initializeCaseOverlay() {
    document
        .getElementById(
            "caseClose"
        )
        ?.addEventListener(
            "click",
            closeCaseOverlay
        );

    document
        .getElementById(
            "caseOverlay"
        )
        ?.addEventListener(
            "click",
            event => {
                if (
                    event.target ===
                    event.currentTarget
                ) {
                    closeCaseOverlay();
                }
            }
        );

    document.addEventListener(
        "keydown",
        event => {
            if (
                event.key ===
                "Escape"
            ) {
                closeCaseOverlay();
            }
        }
    );
}


/* ============================================================
   INTEGRITY — THE CHAIN
   ============================================================ */

function integrityState(
    complaint
) {
    const hash =
        getBlockchainHash(
            complaint
        );

    return {
        anchored:
            Boolean(hash),

        hash:
            hash || "",

        label:
            hash
                ? "LINK VERIFIED"
                : "ANCHOR PENDING"
    };
}


function shortenedHash(
    hash
) {
    if (!hash) {
        return "NOT ANCHORED";
    }

    const value =
        String(hash);

    if (
        value.length <= 20
    ) {
        return value;
    }

    return (
        `${value.slice(0, 10)}` +
        `…` +
        `${value.slice(-8)}`
    );
}


function renderIntegrityDetail(
    complaint
) {
    const detail =
        document.getElementById(
            "integrityDetail"
        );

    if (!detail) {
        openCase(
            complaint.complaint_id
        );

        return;
    }

    const state =
        integrityState(
            complaint
        );

    detail.hidden = false;

    detail.innerHTML = `

        <div class="integrity-detail-head">

            <div>

                <small>
                    INSPECTED LINK
                </small>

                <strong>
                    ${escapeHTML(
                        formatComplaintId(
                            complaint.complaint_id
                        )
                    )}
                </strong>

            </div>

            <span
                class="integrity-detail-state
                ${
                    state.anchored
                        ? "anchored"
                        : "pending"
                }"
            >
                ${
                    state.anchored
                        ? "✓ CHAIN LINK PRESENT"
                        : "× NOT ANCHORED"
                }
            </span>

        </div>


        <div class="integrity-detail-grid">

            <div>

                <small>
                    EVENT
                </small>

                <strong>
                    COMPLAINT RECORD
                </strong>

            </div>

            <div>

                <small>
                    RECORD ID
                </small>

                <strong>
                    ${escapeHTML(
                        formatComplaintId(
                            complaint.complaint_id
                        )
                    )}
                </strong>

            </div>

            <div>

                <small>
                    CREATED
                </small>

                <strong>
                    ${escapeHTML(
                        formatDate(
                            complaint.created_at
                        )
                    )}
                </strong>

            </div>

            <div>

                <small>
                    CURRENT STATUS
                </small>

                <strong>
                    ${escapeHTML(
                        homeStatusLabel(
                            complaint
                        )
                    )}
                </strong>

            </div>

        </div>


        <div class="integrity-detail-hash">

            <small>
                PUBLIC CHAIN HASH
            </small>

            <code>
                ${
                    state.anchored
                        ? escapeHTML(
                            state.hash
                        )
                        : "NO HASH PRESENT IN BACKEND RECORD"
                }
            </code>

        </div>


        <div class="integrity-detail-explanation">

            ${
                state.anchored

                    ? `
                        <strong>
                            This record has an anchor.
                        </strong>

                        <p>
                            CITYFILE received a blockchain
                            transaction hash for this record.
                            The hash is displayed exactly as
                            returned by the backend.
                        </p>
                    `

                    : `
                        <strong>
                            The visible chain breaks here.
                        </strong>

                        <p>
                            This record currently has no
                            blockchain transaction hash.
                            CITYFILE does not invent one or
                            pretend the record is anchored.
                        </p>
                    `
            }

        </div>


        <button
            type="button"
            class="integrity-open-record"
            id="integrityOpenRecord"
        >
            INSPECT COMPLETE RECORD →
        </button>
    `;

    detail
        .querySelector(
            "#integrityOpenRecord"
        )
        ?.addEventListener(
            "click",
            () => {
                openCase(
                    complaint.complaint_id
                );
            }
        );

    detail.scrollIntoView({
        behavior: "smooth",
        block: "nearest"
    });
}


function renderIntegrityEvents() {
    const container =
        document.getElementById(
            "integrityEvents"
        );

    if (!container) {
        return;
    }

    const anchoredRecords =
        allComplaints.filter(
            complaint =>
                Boolean(
                    getBlockchainHash(
                        complaint
                    )
                )
        );

    const verifiedRecords =
        allComplaints.filter(
            isVerified
        );

    const pendingRecords =
        allComplaints.filter(
            complaint =>
                !getBlockchainHash(
                    complaint
                )
        );

    const counts = {
        integrityAnchoredCount:
            anchoredRecords.length,

        integrityPendingCount:
            pendingRecords.length,

        integrityVerifiedCount:
            verifiedRecords.length
    };

    Object.entries(
        counts
    ).forEach(
        ([id, value]) => {
            const element =
                document.getElementById(
                    id
                );

            if (element) {
                element.textContent =
                    Number(value)
                        .toLocaleString(
                            "en-IN"
                        );
            }
        }
    );

    const summary =
        document.getElementById(
            "integrityChainSummary"
        );

    if (summary) {
        if (!allComplaints.length) {
            summary.textContent =
                "NO RECORDS YET";
        }
        else if (
            anchoredRecords.length ===
            allComplaints.length
        ) {
            summary.textContent =
                `✓ CHAIN INTACT · ` +
                `${anchoredRecords.length} / ` +
                `${allComplaints.length} RECORDS ANCHORED`;
        }
        else {
            summary.textContent =
                `${anchoredRecords.length} / ` +
                `${allComplaints.length} RECORDS ANCHORED · ` +
                `${pendingRecords.length} LINK${
                    pendingRecords.length === 1
                        ? ""
                        : "S"
                } PENDING`;
        }
    }

    /*
       Show a manageable section of the
       public chain rather than creating
       hundreds of giant links at once.

       Newest six records are selected,
       then reversed so the visual chain
       reads chronologically.
    */

    const latest =
        [...allComplaints]
            .sort(
                (a, b) =>
                    (
                        Date.parse(
                            b.created_at || ""
                        ) || 0
                    )
                    -
                    (
                        Date.parse(
                            a.created_at || ""
                        ) || 0
                    )
            )
            .slice(
                0,
                6
            )
            .reverse();

    container.innerHTML = "";

    const detail =
        document.getElementById(
            "integrityDetail"
        );

    if (detail) {
        detail.hidden = true;
        detail.innerHTML = "";
    }

    if (!latest.length) {
        container.innerHTML = `

            <div
                class="semantic-empty
                integrity-empty-semantic"
                style="grid-column:1/-1"
            >

                <span
                    class="semantic-empty-number"
                >
                    00
                </span>

                <strong>
                    NO RECORDS TO LINK YET.
                </strong>

                <p>
                    When civic records are created,
                    their integrity state will appear
                    as a visible chain here.
                </p>

            </div>
        `;

        return;
    }

    latest.forEach(
        (
            complaint,
            index
        ) => {
            const state =
                integrityState(
                    complaint
                );

            /*
               A connector is inserted BETWEEN
               records. If the next record lacks
               an anchor, the connector itself
               visually becomes broken.
            */

            if (
                index > 0
            ) {
                const connector =
                    document.createElement(
                        "div"
                    );

                connector.className =
                    `chain-connector ${
                        state.anchored
                            ? "intact"
                            : "broken"
                    }`;

                connector.innerHTML =
                    state.anchored
                        ? `
                            <span></span>
                            <small>
                                VERIFIED LINK
                            </small>
                        `
                        : `
                            <span></span>

                            <strong>
                                ×
                            </strong>

                            <small>
                                CHAIN BREAK
                            </small>
                        `;

                container.appendChild(
                    connector
                );
            }

            const button =
                document.createElement(
                    "button"
                );

            button.type =
                "button";

            button.className =
                `chain-record ${
                    state.anchored
                        ? "anchored"
                        : "pending"
                }`;

            button.dataset
                .complaintId =
                complaint.complaint_id;

            button.innerHTML = `

                <span
                    class="chain-link-visual"
                    aria-hidden="true"
                >

                    <i
                        class="chain-link-core"
                    >
                    </i>

                    <i
                        class="chain-link-inner"
                    >
                    </i>

                </span>


                <span class="chain-record-copy">

                    <small>
                        ${escapeHTML(
                            formatComplaintId(
                                complaint.complaint_id
                            )
                        )}
                    </small>

                    <strong>
                        ${escapeHTML(
                            getCategoryName(
                                complaint
                            )
                        )}
                    </strong>

                    <span>
                        ${
                            state.anchored
                                ? "LINK VERIFIED"
                                : "ANCHOR PENDING"
                        }
                    </span>

                    <code>
                        ${escapeHTML(
                            shortenedHash(
                                state.hash
                            )
                        )}
                    </code>

                </span>
            `;

            button.addEventListener(
                "click",
                () => {
                    container
                        .querySelectorAll(
                            ".chain-record"
                        )
                        .forEach(
                            item => {
                                item.classList.remove(
                                    "active"
                                );
                            }
                        );

                    button.classList.add(
                        "active"
                    );

                    renderIntegrityDetail(
                        complaint
                    );
                }
            );

            container.appendChild(
                button
            );
        }
    );
}


/* ============================================================
   HOME MARKER → ARCHIVE / MAP COMPATIBILITY
   ============================================================ */

function initializeHomeMarkers() {
    document
        .querySelectorAll(
            ".city-record-marker"
        )
        .forEach(
            marker => {
                marker.addEventListener(
                    "keydown",
                    event => {
                        if (
                            event.key !==
                            "Enter"
                            &&
                            event.key !==
                            " "
                        ) {
                            return;
                        }

                        event.preventDefault();

                        openMapFor(
                            marker.dataset
                                .mapFilter ||
                            "all"
                        );
                    }
                );
            }
        );
}


/* ============================================================
   REPORT VIEW HELPERS
   ============================================================ */

function initializeReportHelpers() {
    const city =
        document.getElementById(
            "city"
        );

    city?.addEventListener(
        "change",
        () => {
            const selected =
                city.options[
                    city.selectedIndex
                ];

            const cityName =
                selected?.textContent
                    ?.trim()
                    .toLowerCase();

            const center =
                CITY_CENTERS[
                    cityName
                ];

            if (
                center &&
                reportMap
            ) {
                reportMap.setView(
                    center,
                    12
                );
            }
        }
    );

    const description =
        document.getElementById(
            "description"
        );

    const counter =
        document.getElementById(
            "descriptionCount"
        );

    if (
        description &&
        counter
    ) {
        const update =
            () => {
                counter.textContent =
                    description.value.length;
            };

        description.addEventListener(
            "input",
            update
        );

        update();
    }
}


/* ============================================================
   SMALL UI ENHANCEMENTS
   ============================================================ */

function initializeButtonFeedback() {
    document.addEventListener(
        "click",
        event => {
            const button =
                event.target.closest(
                    "button"
                );

            if (
                !button ||
                button.disabled
            ) {
                return;
            }

            button.classList.add(
                "button-pressed"
            );

            window.setTimeout(
                () => {
                    button.classList.remove(
                        "button-pressed"
                    );
                },
                180
            );
        }
    );
}


function initializeExternalRefreshButtons() {
    document
        .querySelectorAll(
            "[data-refresh-records]"
        )
        .forEach(
            button => {
                button.addEventListener(
                    "click",
                    async () => {
                        button.disabled =
                            true;

                        try {
                            await loadComplaints();
                        }
                        finally {
                            button.disabled =
                                false;
                        }
                    }
                );
            }
        );
}


/* ============================================================
   DATA / VIEW RECOVERY
   ============================================================ */

function ensureInitialView() {
    const active =
        document.querySelector(
            ".view.active-view"
        );

    if (active) {
        return;
    }

    const home =
        document.querySelector(
            '[data-view-name="home"]'
        );

    home?.classList.add(
        "active-view"
    );
}


function handleOnlineState() {
    const update =
        () => {
            document.body
                .classList.toggle(
                    "is-offline",
                    !navigator.onLine
                );

            if (!navigator.onLine) {
                showToast(
                    "You are offline. Existing interface data may remain visible, but CITYFILE cannot reach the backend."
                );
            }
        };

    window.addEventListener(
        "online",
        () => {
            update();

            loadComplaints({
                silent: true
            });
        }
    );

    window.addEventListener(
        "offline",
        update
    );

    update();
}
/* ============================================================
   INTEGRITY INTERACTION HELPERS
   ============================================================ */

function initializeIntegrityInteractions() {
    const container =
        document.getElementById(
            "integrityEvents"
        );

    if (!container) {
        return;
    }

    /*
       Most chain-record click listeners are attached
       while renderIntegrityEvents() builds the chain.

       This delegated listener is only a compatibility
       fallback for chain records that may be inserted
       elsewhere in the page.
    */

    container.addEventListener(
        "dblclick",
        event => {
            const record =
                event.target.closest(
                    ".chain-record[data-complaint-id]"
                );

            if (!record) {
                return;
            }

            const id =
                Number(
                    record.dataset
                        .complaintId
                );

            if (
                Number.isFinite(id)
            ) {
                openCase(id);
            }
        }
    );
}


/* ============================================================
   ACCESSIBILITY / KEYBOARD SUPPORT
   ============================================================ */

function initializeKeyboardSupport() {
    document.addEventListener(
        "keydown",
        event => {
            /*
               Do not hijack keyboard input while
               the user is typing into a form.
            */

            const target =
                event.target;

            const typing =
                target instanceof
                    HTMLInputElement
                ||
                target instanceof
                    HTMLTextAreaElement
                ||
                target instanceof
                    HTMLSelectElement
                ||
                target?.isContentEditable;

            if (typing) {
                return;
            }

            /*
               Escape closes the full-record drawer.
            */

            if (
                event.key ===
                "Escape"
            ) {
                closeCaseOverlay();
            }
        }
    );
}


/* ============================================================
   URL HASH SUPPORT
   ============================================================ */

function viewFromHash() {
    const value =
        window.location.hash
            .replace(
                /^#/,
                ""
            )
            .trim()
            .toLowerCase();

    const allowed =
        new Set([
            "home",
            "archive",
            "track",
            "profile",
            "integrity",
            "map",
            "report"
        ]);

    return allowed.has(value)
        ? value
        : null;
}


function initializeHashNavigation() {
    /*
       CITYFILE still works entirely through
       data-view buttons.

       Hash navigation is an optional enhancement
       for browser back/forward compatibility.
    */

    window.addEventListener(
        "hashchange",
        () => {
            const view =
                viewFromHash();

            if (view) {
                showView(view);
            }
        }
    );
}


/* ============================================================
   HOME / CITY PULSE FALLBACKS
   ============================================================ */

function initializeHomeActions() {
    const explorer =
        document.querySelector(
            ".city-explorer-bar"
        );

    explorer?.addEventListener(
        "click",
        event => {
            /*
               Ignore any child that already has
               its own data-view navigation.
            */

            if (
                event.target.closest(
                    "[data-view]"
                )
            ) {
                return;
            }

            openMapFor(
                "all"
            );
        }
    );
}


/* ============================================================
   PROFILE STORAGE RECOVERY
   ============================================================ */

function cleanupStoredComplaintIds() {
    const ids =
        getMyComplaintIds();

    if (!ids.length) {
        return;
    }

    /*
       We intentionally DO NOT delete IDs merely
       because a backend request did not return
       them today.

       A public civic record should not silently
       disappear from the user's local footprint
       because of a temporary API problem.

       We only remove malformed local values.
    */

    const cleaned =
        ids.filter(
            id => {
                const parsed =
                    Number.parseInt(
                        String(id),
                        10
                    );

                return Number.isFinite(
                    parsed
                );
            }
        );

    if (
        cleaned.length !==
        ids.length
    ) {
        localStorage.setItem(
            "cityfile_my_complaints",
            JSON.stringify(
                cleaned
            )
        );
    }
}


/* ============================================================
   SELECT / REFERENCE DATA RECOVERY
   ============================================================ */

function preserveSelectValue(
    select,
    callback
) {
    if (!select) {
        callback?.();

        return;
    }

    const value =
        select.value;

    callback?.();

    if (
        value &&
        Array.from(
            select.options
        ).some(
            option =>
                option.value ===
                value
        )
    ) {
        select.value =
            value;
    }
}


/* ============================================================
   API HEALTH FEEDBACK
   ============================================================ */

async function checkBackendAvailability() {
    /*
       No extra backend endpoint is assumed here.
       /complaints is already part of the existing
       API contract, so it doubles as the health
       check.
    */

    try {
        await fetchJSON(
            "/complaints"
        );

        document.body.classList.remove(
            "backend-unavailable"
        );

        return true;
    }
    catch {
        document.body.classList.add(
            "backend-unavailable"
        );

        return false;
    }
}


/* ============================================================
   PUBLIC RECORD COUNTERS
   ============================================================ */

function updateGenericRecordCounters() {
    const unresolved =
        allComplaints.filter(
            complaint =>
                !isVerified(
                    complaint
                )
        ).length;

    const verified =
        allComplaints.filter(
            isVerified
        ).length;

    document
        .querySelectorAll(
            "[data-total-record-count]"
        )
        .forEach(
            element => {
                element.textContent =
                    allComplaints.length
                        .toLocaleString(
                            "en-IN"
                        );
            }
        );

    document
        .querySelectorAll(
            "[data-unresolved-record-count]"
        )
        .forEach(
            element => {
                element.textContent =
                    unresolved
                        .toLocaleString(
                            "en-IN"
                        );
            }
        );

    document
        .querySelectorAll(
            "[data-verified-record-count]"
        )
        .forEach(
            element => {
                element.textContent =
                    verified
                        .toLocaleString(
                            "en-IN"
                        );
            }
        );
}


/* ============================================================
   RECORD REFRESH WRAPPER
   ============================================================ */

async function refreshEverything({
    silent = false
} = {}) {
    await loadComplaints({
        silent
    });

    updateGenericRecordCounters();

    /*
       If the user is currently looking at one
       of these views, repaint it after refresh.
    */

    const active =
        document.querySelector(
            ".view.active-view"
        );

    const viewName =
        active?.dataset
            ?.viewName;

    if (
        viewName ===
        "archive"
    ) {
        renderArchive();
    }

    if (
        viewName ===
        "profile"
    ) {
        renderProfileFiles();
    }

    if (
        viewName ===
        "integrity"
    ) {
        renderIntegrityEvents();
    }

    if (
        viewName ===
        "map"
    ) {
        renderMapMarkers();
    }
}


/* ============================================================
   GLOBAL COMPATIBILITY
   ============================================================ */

/*
   Leaflet popup HTML uses window.openCase(),
   so this function must be exposed globally.

   These exports also make the functions easy
   to call from inline HTML buttons if your
   existing index.html contains any.
*/

window.openCase =
    openCase;

window.closeCaseOverlay =
    closeCaseOverlay;

window.showView =
    showView;

window.openMapFor =
    openMapFor;

window.trackComplaint =
    trackComplaint;

window.loadComplaints =
    loadComplaints;

window.refreshEverything =
    refreshEverything;


/* ============================================================
   INITIALIZATION
   ============================================================ */

async function initializeCityfile() {
    ensureInitialView();

    cleanupStoredComplaintIds();

    initializeNavigation();

    initializeArchiveFilters();

    initializeMapFilters();

    initializeComplaintForm();

    initializeEvidencePreview();

    initializeTracking();

    initializeCaseOverlay();

    initializeHomeMarkers();

    initializeHomeActions();

    initializeReportHelpers();

    initializeButtonFeedback();

    initializeExternalRefreshButtons();

    initializeIntegrityInteractions();

    initializeKeyboardSupport();

    initializeHashNavigation();

    handleOnlineState();


    /*
       Load reference data before complaints so
       category/city/department names can be
       resolved even when complaint responses
       contain only IDs.
    */

    await loadReferenceData();

    await loadComplaints();


    updateGenericRecordCounters();

    syncArchiveFilterButtons();

    syncMapFilterButtons();


    /*
       Respect a valid URL hash only after the
       initial interface is ready.
    */

    const hashView =
        viewFromHash();

    if (hashView) {
        showView(
            hashView
        );
    }


    /*
       Start passive refresh after the initial
       backend request has completed.
    */

    startDataRefresh();
}


/* ============================================================
   DOM READY
   ============================================================ */

if (
    document.readyState ===
    "loading"
) {
    document.addEventListener(
        "DOMContentLoaded",
        () => {
            initializeCityfile()
                .catch(
                    error => {
                        console.error(
                            "CITYFILE initialization error:",
                            error
                        );

                        showToast(
                            "CITYFILE could not finish loading."
                        );
                    }
                );
        }
    );
}
else {
    initializeCityfile()
        .catch(
            error => {
                console.error(
                    "CITYFILE initialization error:",
                    error
                );

                showToast(
                    "CITYFILE could not finish loading."
                );
            }
        );
}


/* ============================================================
   FINAL SAFETY HANDLERS
   ============================================================ */

window.addEventListener(
    "unhandledrejection",
    event => {
        console.error(
            "Unhandled CITYFILE promise rejection:",
            event.reason
        );
    }
);


window.addEventListener(
    "error",
    event => {
        /*
           Keep this in the console rather than
           showing a toast for every browser-side
           asset problem.
        */

        console.error(
            "CITYFILE runtime error:",
            event.error ||
            event.message
        );
    }
);

/* =====================================================
   CITYFILES — CUSTOM CURSOR
   ===================================================== */

document.addEventListener("DOMContentLoaded", function () {

    const cursor = document.querySelector(".cityfile-cursor");
    const glow = document.querySelector(".cityfile-cursor-glow");

    if (!cursor || !glow) {
        console.log("CITYFILES cursor elements not found");
        return;
    }

    let mouseX = 0;
    let mouseY = 0;

    let glowX = 0;
    let glowY = 0;


    /* -----------------------------------------
       MOVE CURSOR
       ----------------------------------------- */

    document.addEventListener("mousemove", function (event) {

        mouseX = event.clientX;
        mouseY = event.clientY;

        cursor.style.left = mouseX + "px";
        cursor.style.top = mouseY + "px";

        cursor.style.opacity = "1";


        /* Detect clickable elements */

        const clickable = event.target.closest(
            "a, button, [role='button'], input, select, label, .clickable"
        );

        if (clickable) {

            cursor.classList.add("is-target");
            glow.classList.add("is-target");

        } else {

            cursor.classList.remove("is-target");
            glow.classList.remove("is-target");

        }

    });


    /* -----------------------------------------
       SMOOTH GLOW FOLLOW
       ----------------------------------------- */

    function moveGlow() {

        glowX += (mouseX - glowX) * 0.15;
        glowY += (mouseY - glowY) * 0.15;

        glow.style.left = glowX + "px";
        glow.style.top = glowY + "px";

        requestAnimationFrame(moveGlow);
    }

    moveGlow();


    /* -----------------------------------------
       CLICK ANIMATION
       ----------------------------------------- */

    document.addEventListener("mousedown", function () {

        cursor.classList.add("is-clicking");

    });


    document.addEventListener("mouseup", function () {

        cursor.classList.remove("is-clicking");

    });


    /* -----------------------------------------
       LEAVING WINDOW
       ----------------------------------------- */

    document.addEventListener("mouseleave", function () {

        cursor.style.opacity = "0";
        glow.style.opacity = "0";

    });


    document.addEventListener("mouseenter", function () {

        cursor.style.opacity = "1";
        glow.style.opacity = "1";

    });

});

/* =========================================================
   CITYFILE — MOBILE CONTINUOUS PAGE
   ========================================================= */

function enableMobileContinuousPage() {

    if (window.innerWidth > 680) {
        return;
    }

    const mobileSections = [
        "homeView",
        "archiveView",
        "trackView",
        "integrityView",
        "profileView"
    ];

    mobileSections.forEach(id => {

        const section =
            document.getElementById(id);

        if (!section) {
            console.warn(
                "Mobile section missing:",
                id
            );

            return;
        }

        /*
           IMPORTANT:
           Existing CITYFILE uses active-view
           to decide which page exists visually.

           On mobile we deliberately make ALL
           internal sections active.
        */

        section.classList.add(
            "active-view"
        );

    });

}


/*
   Run AFTER CITYFILE's normal initialization.
*/

window.addEventListener(
    "load",
    () => {

        if (window.innerWidth <= 680) {

            setTimeout(
                enableMobileContinuousPage,
                100
            );

        }

    }
);

