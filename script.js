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
const AUTHORITY_RESOLVED_STATUS = "awaiting verification";

// CITYKEEPERS auth + backend state.
let activeCitykeeperMissionId = null;
let citykeeperHallPeriod = "month";

let citykeeperAuthEnabled = false;
let citykeeperAuthInitialized = false;
let citykeeperCurrentUser = null;
let citykeeperParticipations = [];
let citykeeperProfileData = null;
let citykeeperLeaderboardData = [];
const citykeeperMissionStatsCache = new Map();

// YOUR FILES is backend-owned and scoped to the authenticated Clerk user.
let myComplaints = [];

const CITY_CENTERS = {
    delhi: [28.6139, 77.2090],
    "new delhi": [28.6139, 77.2090],
    sonipat: [28.9931, 77.0151],
    gurugram: [28.4595, 77.0266],
    gurgaon: [28.4595, 77.0266],
    rohtak: [28.8955, 76.6066]
};

let allComplaints = [];
let blockchainHashesByComplaintId = new Map();
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

let currentAuthorityComplaintId = null;
let currentCaseComplaintId = null;
let currentAuthorityProofImage = null;
let currentAuthorityCoordinates = null;
let activeAuthorityCategory = "all";
let activeAuthorityStatus = "all";
let authoritySearchTerm = "";
let authoritySortOrder = "oldest";

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



function publicFileURL(value = "") {
    const path = String(value || "").trim();
    if (!path) return "";
    if (/^https?:\/\//i.test(path) || path.startsWith("data:")) {
        return path;
    }
    return `${API_BASE_URL}${path}`;
}

function complaintById(complaintId) {
    const id = Number(complaintId);
    return allComplaints.find(
        item => Number(item?.complaint_id) === id
    ) || null;
}

function getResolutionAttempts(complaintId) {
    const complaint = complaintById(complaintId);
    return Array.isArray(complaint?.resolution_attempts)
        ? complaint.resolution_attempts
        : [];
}

function getAuthorityProof(complaintId) {
    const attempts = getResolutionAttempts(complaintId);
    return attempts.length
        ? attempts[attempts.length - 1]?.proof || null
        : null;
}

function getCitizenReview(complaintId) {
    const attempts = getResolutionAttempts(complaintId);
    return attempts.length
        ? attempts[attempts.length - 1]?.review || null
        : null;
}

function upsertComplaintRecord(record) {
    if (!record || record.complaint_id === undefined) return null;

    const id = Number(record.complaint_id);
    const index = allComplaints.findIndex(
        item => Number(item.complaint_id) === id
    );

    if (index >= 0) {
        allComplaints[index] = record;
    }
    else {
        allComplaints.push(record);
    }

    if (Array.isArray(record.evidence)) {
        backendEvidenceCache.set(id, record.evidence);
    }

    return record;
}

function isCitizenReopened(complaint) {
    const review = getCitizenReview(complaint?.complaint_id);
    return review?.action === "reopened" || review?.action === "questioned";
}

function normalizeStatus(complaint) {
    return String(
        complaint?.status || "Submitted"
    )
        .trim()
        .toLowerCase();
}


function isVerified(complaint) {
    const review = getCitizenReview(complaint?.complaint_id);

    if (review?.action === "verified") {
        return true;
    }

    if (review?.action === "reopened" || review?.action === "questioned") {
        return false;
    }

    return (
        normalizeStatus(complaint) ===
        VERIFIED_STATUS
    );
}


function isAuthorityResolved(complaint) {
    if (isCitizenReopened(complaint)) {
        return false;
    }

    if (getAuthorityProof(complaint?.complaint_id)) {
        return true;
    }

    return (
        normalizeStatus(complaint) ===
        AUTHORITY_RESOLVED_STATUS
    );
}


function isAcknowledged(complaint) {
    return normalizeStatus(complaint) === "acknowledged";
}

function isInProgress(complaint) {
    return [
        "in progress",
        "in_progress",
        "assigned",
        "working"
    ].includes(
        normalizeStatus(complaint)
    );
}


function formatComplaintId(id) {
    const number = Number(id);

    return Number.isFinite(number)
        ? `CF-${String(number).padStart(6, "0")}`
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
    const complaintId = Number(complaint?.complaint_id);

    return (
        complaint?.blockchain_hash ||
        complaint?.blockchain_tx_hash ||
        complaint?.blockchain_hash ||
        complaint?.tx_hash ||
        complaint?.transaction_hash ||
        blockchainHashesByComplaintId.get(complaintId) ||
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

    if (isCitizenReopened(complaint)) {
        return "REOPENED · ACTION REQUIRED";
    }

    if (isAuthorityResolved(complaint)) {
        return "VERIFY FIX";
    }

    if (isAcknowledged(complaint)) {
        return "ACKNOWLEDGED";
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


async function getCitykeeperSessionToken() {
    try {
        const session =
            window.Clerk?.session;

        if (!session) {
            return null;
        }

        return await session.getToken();
    }
    catch (error) {
        console.warn(
            "Could not get Clerk session token:",
            error
        );

        return null;
    }
}


async function fetchJSON(
    path,
    options = {}
) {
    const requestOptions = {
        ...options
    };

    const headers = new Headers(
        options.headers || {}
    );

    const token =
        await getCitykeeperSessionToken();

    if (token) {
        headers.set(
            "Authorization",
            `Bearer ${token}`
        );
    }

    requestOptions.headers = headers;

    const response = await fetch(
        `${API_BASE_URL}${path}`,
        requestOptions
    );

    let data = null;

    try {
        data = await response.json();
    }
    catch {
        data = null;
    }

    if (!response.ok) {
        const error = new Error(
            data?.detail ||
            data?.message ||
            `Request failed (${response.status})`
        );

        error.status = response.status;
        error.data = data;

        throw error;
    }

    return data;
}


function loadExternalScript(
    src,
    attributes = {}
) {
    return new Promise(
        (resolve, reject) => {
            const existing =
                document.querySelector(
                    `script[src="${src}"]`
                );

            if (existing) {
                if (
                    existing.dataset.cityfileLoaded ===
                    "true"
                ) {
                    resolve();
                    return;
                }

                existing.addEventListener(
                    "load",
                    () => resolve(),
                    { once: true }
                );

                existing.addEventListener(
                    "error",
                    () => reject(
                        new Error(
                            `Could not load ${src}`
                        )
                    ),
                    { once: true }
                );

                return;
            }

            const script =
                document.createElement(
                    "script"
                );

            script.src = src;
            script.async = true;
            script.crossOrigin =
                "anonymous";

            Object.entries(
                attributes
            ).forEach(
                ([key, value]) => {
                    script.setAttribute(
                        key,
                        value
                    );
                }
            );

            script.addEventListener(
                "load",
                () => {
                    script.dataset.cityfileLoaded =
                        "true";
                    resolve();
                },
                { once: true }
            );

            script.addEventListener(
                "error",
                () => reject(
                    new Error(
                        `Could not load ${src}`
                    )
                ),
                { once: true }
            );

            document.head.appendChild(
                script
            );
        }
    );
}


function clerkFrontendDomain(
    publishableKey
) {
    try {
        return atob(
            publishableKey.split("_")[2]
        ).slice(0, -1);
    }
    catch {
        return "";
    }
}


function renderCitykeeperAuthButton() {
    const button =
        document.getElementById(
            "citykeeperAuthButton"
        );

    if (!button) {
        return;
    }

    if (!citykeeperAuthEnabled) {
        button.innerHTML =
            `AUTH NOT CONFIGURED <span>!</span>`;
        return;
    }

    if (citykeeperCurrentUser) {
        button.innerHTML =
            `${escapeHTML(
                citykeeperCurrentUser
                    .public_user_id ||
                "CITYKEEPER"
            )} <span>↗</span>`;
        return;
    }

    button.innerHTML =
        `SIGN IN TO JOIN <span>→</span>`;
}


async function loadCitykeeperCurrentUser() {
    if (
        !citykeeperAuthEnabled ||
        !window.Clerk?.user
    ) {
        citykeeperCurrentUser = null;
        renderCitykeeperAuthButton();
        return null;
    }

    try {
        citykeeperCurrentUser =
            await fetchJSON(
                "/auth/me"
            );
    }
    catch (error) {
        console.warn(
            "Could not load authenticated Citykeeper:",
            error
        );

        citykeeperCurrentUser = null;
    }

    renderCitykeeperAuthButton();

    return citykeeperCurrentUser;
}


async function refreshCitykeeperAuthData() {
    await loadCitykeeperCurrentUser();

    await Promise.all([
        loadCitykeeperParticipations(),
        loadCitykeeperProfile(),
        loadCitykeeperMissionStats(),
        loadCitykeeperLeaderboard(),
        loadMyComplaints()
    ]);

    renderCitykeepers();
    renderProfileFiles();
    renderAuthorityDashboard();
}


async function initializeClerkAuth() {
    if (citykeeperAuthInitialized) {
        return;
    }

    citykeeperAuthInitialized = true;

    let config = null;

    try {
        config = await fetchJSON(
            "/config"
        );
    }
    catch (error) {
        console.warn(
            "Could not load Clerk configuration:",
            error
        );

        citykeeperAuthEnabled = false;
        renderCitykeeperAuthButton();
        return;
    }

    const publishableKey =
        String(
            config?.clerk_publishable_key ||
            ""
        ).trim();

    citykeeperAuthEnabled =
        Boolean(
            config?.clerk_enabled &&
            publishableKey
        );

    if (!citykeeperAuthEnabled) {
        renderCitykeeperAuthButton();
        return;
    }

    const frontendDomain =
        clerkFrontendDomain(
            publishableKey
        );

    if (!frontendDomain) {
        citykeeperAuthEnabled = false;
        renderCitykeeperAuthButton();
        return;
    }

    try {
        await loadExternalScript(
            `https://${frontendDomain}/npm/@clerk/ui@1/dist/ui.browser.js`
        );

        await loadExternalScript(
            `https://${frontendDomain}/npm/@clerk/clerk-js@6/dist/clerk.browser.js`,
            {
                "data-clerk-publishable-key":
                    publishableKey
            }
        );

        if (!window.Clerk) {
            throw new Error(
                "ClerkJS did not initialize."
            );
        }

        await window.Clerk.load({
            ui: {
                ClerkUI:
                    window.__internal_ClerkUICtor
            }
        });

        window.Clerk.addListener(
            async () => {
                await refreshCitykeeperAuthData();
            },
            {
                skipInitialEmit: true
            }
        );

        await loadCitykeeperCurrentUser();
    }
    catch (error) {
        console.error(
            "Clerk initialization error:",
            error
        );

        citykeeperAuthEnabled = false;
        citykeeperCurrentUser = null;
        renderCitykeeperAuthButton();
    }
}


async function openCitykeeperAuth() {
    if (!citykeeperAuthEnabled) {
        showToast(
            "Clerk is not configured yet."
        );
        return;
    }

    if (!window.Clerk) {
        showToast(
            "Authentication is still loading."
        );
        return;
    }

    if (window.Clerk.user) {
        await window.Clerk.openUserProfile();
        return;
    }

    await window.Clerk.openSignIn();
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

    // MOBILE:
    // Home/archive/track/integrity/profile are part of the
    // continuous page. Report + map are made visible when selected.
    if (isMobile) {

        if (
    viewName === "report" ||
    viewName === "map"
) {
    document
        .querySelectorAll("#reportView, #mapView")
        .forEach(view => {
            view.classList.remove("active-view");
        });

    requested.classList.add("active-view");
}

        // Wait until the browser has laid out the section
        requestAnimationFrame(() => {
            requestAnimationFrame(() => {

                const header =
                    document.querySelector(".site-header");

                const headerHeight =
                    header?.offsetHeight || 0;

                const targetTop =
                    requested.getBoundingClientRect().top +
                    window.pageYOffset -
                    headerHeight -
                    8;

                window.scrollTo({
                    top: targetTop,
                    behavior: "smooth"
                });
            });
        });

    }

    // DESKTOP:
    // retain the original one-view-at-a-time behaviour
    else {

        document
            .querySelectorAll(".view")
            .forEach(view => {
                view.classList.toggle(
                    "active-view",
                    view === requested
                );
            });

        window.scrollTo({
            top: 0,
            behavior: "auto"
        });
    }

    document
        .querySelectorAll(".nav-link")
        .forEach(button => {
            button.classList.toggle(
                "active",
                button.dataset.view === viewName
            );
        });

    if (viewName === "map") {
        setTimeout(() => {
            initializeCityMap();
            cityMap?.invalidateSize();
            renderMapMarkers();
        }, 100);
    }

    if (viewName === "report") {
        setTimeout(() => {
            initializeReportMap();
            reportMap?.invalidateSize();
        }, 100);
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

    if (viewName === "authority") {
        renderAuthorityDashboard();
    }

    if (viewName === "citykeepers") {
        renderCitykeepers();
    }
}


function openMapFor(filter = "all") {
    const allowed = new Set([
        "all",
        "road",
        "water",
        "drainage",
        "sanitation",
        "streetlight",
        "safety",
        "other"
    ]);

    activeMapFilter = allowed.has(filter)
        ? filter
        : "all";

    syncMapFilterButtons();
    showView("map");

    setTimeout(() => {
        initializeCityMap();
        cityMap?.invalidateSize();
        renderMapMarkers();
    }, 100);
}
function openHomeCategoryRecords(group) {

    const overlay =
        document.getElementById("caseOverlay");

    const body =
        document.getElementById("caseContent");

    if (!overlay || !body) {
        return;
    }

    const records =
        allComplaints.filter(
            complaint =>
                issueGroup(complaint) === group
        );

    const categoryNames = {
        road: "POTHOLE",
        water: "PIPE LEAK",
        sanitation: "WASTE",
        streetlight: "STREETLIGHT"
    };

    const categoryName =
        categoryNames[group] || "PROBLEMS";


    /* -----------------------------------------
       NO RECORDS
       ----------------------------------------- */

    if (records.length === 0) {

        body.innerHTML = `

            <div class="case-record">

                <section class="case-record-intro">

                    <small>
                        CITYFILE / PUBLIC RECORDS
                    </small>

                    <h2>
                        ${categoryName}
                    </h2>

                    <p>
                        No ${categoryName.toLowerCase()}
                        problems have been reported yet.
                    </p>

                </section>

            </div>

        `;

    }


    /* -----------------------------------------
       RECORDS EXIST
       ----------------------------------------- */

    else {

        body.innerHTML = `

            <div class="case-record">

                <section class="case-record-intro">

                    <small>
                        CITYFILE / PUBLIC RECORDS
                    </small>

                    <h2>
                        ${categoryName}
                    </h2>

                    <p>
                        ${records.length}
                        reported problem${records.length === 1 ? "" : "s"}
                    </p>

                </section>


                <section class="case-record-section">

                    <div class="case-section-heading">

                        <small>
                            REPORTED PROBLEMS
                        </small>

                        <h3>
                            ${categoryName} RECORDS
                        </h3>

                    </div>


                    <div class="home-category-record-list">

                        ${records.map(complaint => `

                            <article
                                class="home-category-record"
                            >

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
                                            publicLocation(
                                                complaint
                                            )
                                        )}
                                    </h4>

                                    <p>
                                        ${escapeHTML(
                                            complaint.description ||
                                            "No description recorded."
                                        )}
                                    </p>

                                </div>


                                <div>

                                    <strong>
                                        ${escapeHTML(
                                            homeStatusLabel(
                                                complaint
                                            )
                                        )}
                                    </strong>


                                    <button
                                        type="button"
                                        onclick="openCase(${Number(
                                            complaint.complaint_id
                                        )})"
                                    >
                                        OPEN FILE →
                                    </button>

                                </div>

                            </article>

                        `).join("")}

                    </div>

                </section>

            </div>

        `;
    }


    /* -----------------------------------------
       OPEN EXISTING POPUP
       ----------------------------------------- */

    overlay.hidden = false;

    document.body.classList.add("case-open");
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
                openHomeCategoryRecords(
                    marker.dataset.mapFilter || "all"
                );

                return;
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


function filterDepartmentsForSelectedCity() {
    const citySelect = document.getElementById("city");
    const departmentSelect = document.getElementById("department");

    if (!citySelect || !departmentSelect) {
        return;
    }

    const selectedCityId = Number(citySelect.value);
    const previousValue = departmentSelect.value;

    const departments = Number.isFinite(selectedCityId)
        ? referenceData.departments.filter(
            item => Number(item.city_id) === selectedCityId
        )
        : referenceData.departments;

    fillSelect(
        "department",
        departments,
        "department_id",
        "department_name",
        selectedCityId
            ? (departments.length
                ? "Select department"
                : "No departments available for this city")
            : "Select city first"
    );

    if (
        previousValue &&
        Array.from(departmentSelect.options).some(
            option => option.value === previousValue
        )
    ) {
        departmentSelect.value = previousValue;
    }

    departmentSelect.disabled =
        !Number.isFinite(selectedCityId) ||
        departments.length === 0;
}


function initializeCityDepartmentLink() {
    const citySelect = document.getElementById("city");

    citySelect?.addEventListener(
        "change",
        filterDepartmentsForSelectedCity
    );

    filterDepartmentsForSelectedCity();
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

        filterDepartmentsForSelectedCity();
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
   AUTHORITY OPERATIONS DESK + CITIZEN RESOLUTION REVIEW
   Backend-backed authority proof and citizen verification.
   ============================================================ */

const AUTHORITY_CATEGORY_META = {
    all: { label: "ALL PROBLEMS", image: "assets/all.jpg" },
    road: { label: "POTHOLES", image: "assets/pothole.jpg" },
    sanitation: { label: "GARBAGE", image: "assets/garbage.jpg" },
    water: { label: "WATER LEAKS", image: "assets/water.jpg" },
    drainage: { label: "DRAINAGE", image: "assets/drainage.jpg" },
    streetlight: { label: "STREETLIGHTS", image: "assets/streetlight.jpg" },
    safety: { label: "SAFETY", image: "assets/safety.jpg" },
    other: { label: "OTHER", image: "assets/other.jpg" }
};

function formatAuthorityCoordinate(value) {
    const number = Number(value);
    return Number.isFinite(number) ? number.toFixed(6) : "NOT RECORDED";
}

function compressAuthorityImage(file, maxDimension = 1200, quality = 0.72) {
    return new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onerror = () => reject(new Error("Could not read the selected image."));
        reader.onload = () => {
            const image = new Image();
            image.onerror = () => reject(new Error("The selected file is not a readable image."));
            image.onload = () => {
                const scale = Math.min(1, maxDimension / Math.max(image.width, image.height));
                const canvas = document.createElement("canvas");
                canvas.width = Math.max(1, Math.round(image.width * scale));
                canvas.height = Math.max(1, Math.round(image.height * scale));
                const context = canvas.getContext("2d");
                context.drawImage(image, 0, 0, canvas.width, canvas.height);
                resolve(canvas.toDataURL("image/jpeg", quality));
            };
            image.src = reader.result;
        };
        reader.readAsDataURL(file);
    });
}

function authorityCardStatus(complaint) {
    if (isVerified(complaint)) return "CITIZEN VERIFIED";
    if (isCitizenReopened(complaint)) return "RETURNED BY CITIZEN";
    if (isAuthorityResolved(complaint)) return "AWAITING CITIZEN VERIFICATION";
    if (isInProgress(complaint)) return "WORK IN PROGRESS";
    if (isAcknowledged(complaint)) return "ACKNOWLEDGED · AWAITING WORK";
    return "ACTION REQUIRED";
}

function authorityCardClass(complaint) {
    if (isVerified(complaint)) return "is-verified";
    if (isCitizenReopened(complaint)) return "is-reopened";
    if (isAuthorityResolved(complaint)) return "is-review";
    if (isInProgress(complaint)) return "is-progress";
    return "is-waiting";
}

function authorityStatusMatches(complaint, filter) {
    if (filter === "all") return true;
    if (filter === "verified") return isVerified(complaint);
    if (filter === "returned") return isCitizenReopened(complaint);
    if (filter === "review") return !isVerified(complaint) && isAuthorityResolved(complaint);
    if (filter === "progress") {
        return !isVerified(complaint) && !isCitizenReopened(complaint) && !isAuthorityResolved(complaint) && isInProgress(complaint);
    }
    if (filter === "action") return !isVerified(complaint) && !isAuthorityResolved(complaint);
    return true;
}

function authoritySearchMatches(complaint) {
    const query = authoritySearchTerm.trim().toLowerCase();
    if (!query) return true;

    const searchable = [
        formatComplaintId(complaint.complaint_id),
        complaint.complaint_id,
        getCategoryName(complaint),
        getDepartmentName(complaint),
        publicLocation(complaint),
        complaint.description,
        complaint.priority,
        authorityCardStatus(complaint)
    ].join(" ").toLowerCase();

    return searchable.includes(query);
}

function authorityCategoryCounts(group) {
    const records = group === "all"
        ? allComplaints
        : allComplaints.filter(complaint => issueGroup(complaint) === group);

    const active = records.filter(complaint => !isVerified(complaint));
    return {
        active: active.length,
        action: active.filter(complaint => !isAuthorityResolved(complaint)).length,
        review: active.filter(complaint => isAuthorityResolved(complaint)).length,
        verified: records.filter(isVerified).length
    };
}

function renderAuthorityCategoryCards() {
    const container = document.getElementById("authorityCategoryGrid");
    if (!container) return;

    const baseGroups = ["all", "road", "sanitation", "water", "drainage", "streetlight", "safety"];
    const hasOther = allComplaints.some(complaint => issueGroup(complaint) === "other");
    const groups = hasOther ? [...baseGroups, "other"] : baseGroups;

    container.innerHTML = groups.map(group => {
        const meta = AUTHORITY_CATEGORY_META[group];
        const counts = authorityCategoryCounts(group);
        const selected = activeAuthorityCategory === group;

        return `
            <button type="button"
                class="authority-category-card ${selected ? "active" : ""}"
                data-authority-category="${group}"
                aria-pressed="${selected ? "true" : "false"}">
                <span class="authority-category-media" style="background-image:linear-gradient(180deg,rgba(5,9,12,.05),rgba(5,9,12,.88)),url('${meta.image}')"></span>
                <span class="authority-category-content">
                    <small>${group === "all" ? "CITYWIDE" : "CATEGORY"}</small>
                    <strong>${escapeHTML(meta.label)}</strong>
                    <span class="authority-category-primary"><b>${counts.active}</b> ACTIVE</span>
                    <span class="authority-category-stats">
                        <i>${counts.action} need action</i>
                        <i>${counts.review} awaiting review</i>
                        <i>${counts.verified} verified</i>
                    </span>
                </span>
            </button>`;
    }).join("");
}

function authorityLifecycleMarkup(complaint) {
    const proof = getAuthorityProof(complaint.complaint_id);
    const review = getCitizenReview(complaint.complaint_id);
    const actionDone = isInProgress(complaint) || Boolean(proof) || isVerified(complaint) || isCitizenReopened(complaint);
    const proofDone = Boolean(proof);
    const citizenDone = Boolean(review);

    const citizenClass = review?.action === "verified"
        ? "done"
        : (review?.action === "reopened" || review?.action === "questioned")
            ? "failed"
            : proofDone ? "current" : "";

    return `
        <div class="authority-lifecycle" aria-label="Complaint lifecycle">
            <span class="done"><b>01</b><i>REPORT</i></span>
            <span class="${actionDone ? "done" : "current"}"><b>02</b><i>ACTION</i></span>
            <span class="${proofDone ? "done" : ""}"><b>03</b><i>PROOF</i></span>
            <span class="${citizenClass}"><b>04</b><i>CITIZEN</i></span>
        </div>`;
}

function renderAuthorityLongestWaiting() {
    const section = document.getElementById("authorityLongestWaitingSection");
    const container = document.getElementById("authorityLongestWaiting");
    if (!section || !container) return;

    const records = allComplaints
        .filter(complaint => !isVerified(complaint) && !isAuthorityResolved(complaint))
        .filter(complaint => activeAuthorityCategory === "all" || issueGroup(complaint) === activeAuthorityCategory)
        .sort((a, b) => complaintAgeMs(b) - complaintAgeMs(a));

    const complaint = records[0];
    if (!complaint) {
        section.hidden = true;
        container.innerHTML = "";
        return;
    }

    section.hidden = false;
    const id = Number(complaint.complaint_id);
    const returned = isCitizenReopened(complaint);

    container.innerHTML = `
        <div class="authority-longest-age">
            <small>${returned ? "RETURNED · STILL OPEN" : "OPEN FOR"}</small>
            <strong>${escapeHTML(formatDuration(complaintAgeMs(complaint)))}</strong>
        </div>
        <div class="authority-longest-copy">
            <span>${escapeHTML(formatComplaintId(id))}</span>
            <strong>${escapeHTML(getCategoryName(complaint))}</strong>
            <p>${escapeHTML(publicLocation(complaint))}</p>
        </div>
        <button type="button" onclick="window.openAuthorityAction(${id})">OPEN WORK FILE →</button>`;
}

function renderAuthorityDashboard() {
    const grid = document.getElementById("authorityComplaintGrid");

    const active = allComplaints.filter(complaint => !isVerified(complaint));
    const waiting = active.filter(complaint => !isAuthorityResolved(complaint));
    const review = active.filter(complaint => isAuthorityResolved(complaint));
    const returned = active.filter(isCitizenReopened);
    const verified = allComplaints.filter(isVerified);

    const counters = {
        authorityActiveCount: active.length,
        authorityWaitingCount: waiting.length,
        authorityReviewCount: review.length,
        authorityReturnedCount: returned.length,
        authorityVerifiedCount: verified.length
    };

    Object.entries(counters).forEach(([id, value]) => {
        const element = document.getElementById(id);
        if (element) element.textContent = Number(value).toLocaleString("en-IN");
    });

    renderAuthorityCategoryCards();
    renderAuthorityLongestWaiting();

    if (!grid) return;

    const searchInput = document.getElementById("authoritySearch");
    if (searchInput && searchInput.value !== authoritySearchTerm) searchInput.value = authoritySearchTerm;

    const sortSelect = document.getElementById("authoritySort");
    if (sortSelect && sortSelect.value !== authoritySortOrder) sortSelect.value = authoritySortOrder;

    document.querySelectorAll("[data-authority-status]").forEach(button => {
        button.classList.toggle("active", button.dataset.authorityStatus === activeAuthorityStatus);
    });

    if (!allComplaints.length) {
        grid.innerHTML = `<div class="authority-empty-state">No civic complaints are currently available from the backend.</div>`;
        const count = document.getElementById("authorityQueueCount");
        if (count) count.textContent = "0 FILES";
        return;
    }

    let records = allComplaints
        .filter(complaint => activeAuthorityCategory === "all" || issueGroup(complaint) === activeAuthorityCategory)
        .filter(complaint => authorityStatusMatches(complaint, activeAuthorityStatus))
        .filter(authoritySearchMatches);

    records = records.sort((a, b) => {
        const aTime = Date.parse(a.created_at || "") || 0;
        const bTime = Date.parse(b.created_at || "") || 0;
        return authoritySortOrder === "newest" ? bTime - aTime : aTime - bTime;
    });

    const count = document.getElementById("authorityQueueCount");
    if (count) count.textContent = `${records.length.toLocaleString("en-IN")} ${records.length === 1 ? "FILE" : "FILES"}`;

    if (!records.length) {
        grid.innerHTML = `<div class="authority-empty-state">No records match the selected category, status and search.</div>`;
        return;
    }

    grid.innerHTML = records.map(complaint => {
        const id = Number(complaint.complaint_id);
        const proof = getAuthorityProof(id);
        const canRecordFix = !isVerified(complaint) && !isAuthorityResolved(complaint);
        const attempts = getResolutionAttempts(id);
        const reopened = isCitizenReopened(complaint);
        const status = normalizeStatus(complaint);
        const canAcknowledge = ["submitted", "open", "disputed"].includes(status);
        const canStartWork = ["submitted", "open", "acknowledged", "disputed"].includes(status);

        return `
            <article class="authority-record-card ${authorityCardClass(complaint)}">
                <div class="authority-record-topline">
                    <span class="authority-record-id">${escapeHTML(formatComplaintId(id))}</span>
                    <span class="authority-record-age">OPEN ${escapeHTML(formatDuration(complaintAgeMs(complaint)))}</span>
                </div>

                <div class="authority-record-main">
                    <div class="authority-record-copy">
                        <small>${escapeHTML(AUTHORITY_CATEGORY_META[issueGroup(complaint)]?.label || getCategoryName(complaint))}</small>
                        <h4>${escapeHTML(getCategoryName(complaint))}</h4>
                        <p class="authority-record-location">${escapeHTML(publicLocation(complaint))}</p>
                        <p class="authority-record-description">${escapeHTML(complaint.description || "No description recorded.")}</p>
                        <span class="authority-responsible-label">RESPONSIBLE · ${escapeHTML(getDepartmentName(complaint))}</span>
                        <span class="authority-responsible-label">PRIORITY · ${escapeHTML(complaint.priority || "Medium")} · DEADLINE · ${escapeHTML(complaint.deadline ? formatDate(complaint.deadline) : "NOT SET")}</span>
                    </div>

                    <div class="authority-record-state">
                        <small>CURRENT STATE</small>
                        <strong>${escapeHTML(authorityCardStatus(complaint))}</strong>
                        ${attempts.length ? `<span>${attempts.length} resolution ${attempts.length === 1 ? "attempt" : "attempts"} recorded</span>` : ""}
                    </div>
                </div>

                ${authorityLifecycleMarkup(complaint)}

                <div class="authority-record-actions">
                    ${canAcknowledge ? `<button type="button" class="secondary" onclick="window.updateAuthorityStatus(${id}, 'Acknowledged')">ACKNOWLEDGE</button>` : ""}
                    ${canStartWork ? `<button type="button" class="secondary" onclick="window.updateAuthorityStatus(${id}, 'In Progress')">START / CONTINUE WORK</button>` : ""}
                    ${!isVerified(complaint) ? `<button type="button" class="secondary" onclick="window.updateAuthorityDeadline(${id})">${complaint.deadline ? "CHANGE DEADLINE" : "SET DEADLINE"}</button>` : ""}
                    ${canRecordFix ? `<button type="button" onclick="window.openAuthorityAction(${id})">${reopened && proof ? "RECORD NEW ATTEMPT" : "OPEN WORK FILE"} →</button>` : ""}
                    ${proof && !isVerified(complaint) && !reopened ? `<button type="button" class="waiting" onclick="window.openCase(${id})">AWAITING CITIZEN</button>` : ""}
                    <button type="button" class="secondary" onclick="window.openCase(${id})">${proof ? "VIEW PUBLIC PROOF" : "INSPECT RECORD"}</button>
                </div>
            </article>`;
    }).join("");
}

function resetAuthorityActionState() {
    currentAuthorityComplaintId = null;
    currentAuthorityProofImage = null;
    currentAuthorityCoordinates = null;
}

function updateAuthorityGeoDisplay() {
    const status = document.getElementById("authorityGeoStatus");
    const coordinates = document.getElementById("authorityGeoCoordinates");
    if (!status || !coordinates) return;

    if (!currentAuthorityCoordinates) {
        status.textContent = "GEOTAG REQUIRED";
        coordinates.textContent = "Capture the current location while submitting the solved proof.";
        return;
    }

    status.textContent = "GEOTAG CAPTURED";
    coordinates.textContent = `${formatAuthorityCoordinate(currentAuthorityCoordinates.latitude)}, ${formatAuthorityCoordinate(currentAuthorityCoordinates.longitude)} · accuracy ±${Math.round(Number(currentAuthorityCoordinates.accuracy) || 0)} m`;
}
const backendEvidenceCache = new Map();
const citykeeperVerificationCache = new Map();
async function loadBackendEvidence(complaintId) {
    try {
        const evidenceList = await fetchJSON(
            `/complaints/${complaintId}/evidence`
        );

        backendEvidenceCache.set(
            Number(complaintId),
            Array.isArray(evidenceList)
                ? evidenceList
                : []
        );
    }
    catch (error) {
        console.warn(
            `Could not load evidence for complaint ${complaintId}:`,
            error
        );

        backendEvidenceCache.set(
            Number(complaintId),
            []
        );
    }
}

async function loadCitykeeperVerification(complaintId) {
    try {
        const verification = await fetchJSON(
            `/citykeepers/${complaintId}/verification`
        );

        citykeeperVerificationCache.set(
            Number(complaintId),
            verification || null
        );
    }
    catch (error) {
        console.warn(
            `Could not load Citykeeper verification for complaint ${complaintId}:`,
            error
        );

        citykeeperVerificationCache.set(
            Number(complaintId),
            null
        );
    }
}

async function loadCitykeeperParticipations() {
    citykeeperParticipations = [];

    if (!citykeeperCurrentUser) {
        return [];
    }

    try {
        const participations =
            await fetchJSON(
                "/citykeepers/participations"
            );

        citykeeperParticipations =
            Array.isArray(participations)
                ? participations
                : [];

        return citykeeperParticipations;
    }
    catch (error) {
        console.warn(
            "Could not load Citykeeper participations:",
            error
        );

        citykeeperParticipations = [];

        return [];
    }
}


async function loadCitykeeperProfile() {
    if (!citykeeperCurrentUser) {
        citykeeperProfileData = null;
        return null;
    }

    try {
        citykeeperProfileData =
            await fetchJSON(
                "/citykeepers/me"
            );

        return citykeeperProfileData;
    }
    catch (error) {
        console.warn(
            "Could not load Citykeeper profile:",
            error
        );

        citykeeperProfileData = null;

        return null;
    }
}


async function loadCitykeeperLeaderboard() {
    try {
        const result =
            await fetchJSON(
                `/citykeepers/leaderboard?period=${encodeURIComponent(
                    citykeeperHallPeriod
                )}`
            );

        citykeeperLeaderboardData =
            Array.isArray(result?.entries)
                ? result.entries
                : [];

        return citykeeperLeaderboardData;
    }
    catch (error) {
        console.warn(
            "Could not load Citykeeper leaderboard:",
            error
        );

        citykeeperLeaderboardData = [];

        return [];
    }
}


async function loadCitykeeperMissionStats() {
    try {
        const rows =
            await fetchJSON(
                "/citykeepers/mission-stats"
            );

        citykeeperMissionStatsCache.clear();

        for (
            const row of (
                Array.isArray(rows)
                    ? rows
                    : []
            )
        ) {
            citykeeperMissionStatsCache.set(
                Number(row.complaint_id),
                row
            );
        }

        return rows;
    }
    catch (error) {
        console.warn(
            "Could not load Citykeeper mission stats:",
            error
        );

        citykeeperMissionStatsCache.clear();

        return [];
    }
}

function citizenEvidenceMarkup(complaint) {
    const complaintId =
        Number(complaint.complaint_id);

    const evidenceList =
        backendEvidenceCache.get(
            complaintId
        ) || [];

    const citizenEvidence =
        evidenceList.find(
            evidence =>
                evidence.evidence_type ===
                "citizen_report"
        );

    if (citizenEvidence?.file_url) {
        const imageURL =
            publicFileURL(citizenEvidence.file_url);

        return `
            <div class="authority-before-media">
                <img
                    src="${escapeHTML(imageURL)}"
                    alt="Citizen submitted evidence from the original complaint"
                >
                <span>ORIGINAL CITIZEN EVIDENCE</span>
            </div>`;
    }

    return `
        <div class="authority-evidence-unavailable">
            <small>ORIGINAL CITIZEN EVIDENCE</small>
            <strong>IMAGE NOT AVAILABLE</strong>
            <p>No original citizen photograph is attached to this record.</p>
        </div>`;
}

function openAuthorityAction(complaintId) {
    const id = Number(complaintId);
    const complaint = allComplaints.find(item => Number(item.complaint_id) === id);
    const panel = document.getElementById("authorityActionPanel");
    const selected = document.getElementById("authoritySelectedRecord");
    const originalRecord = document.getElementById("authorityOriginalRecord");
    const idInput = document.getElementById("authorityComplaintId");

    if (!complaint || !panel || !selected || !originalRecord || !idInput) return;

    if (!citykeeperCurrentUser) {
        showToast("Sign in with an authorized authority account to record action.");
        openCitykeeperAuth();
        return;
    }

    if (!citykeeperCurrentUser.is_authority) {
        showToast("This signed-in account is not authorized for authority actions.");
        return;
    }

    if (isVerified(complaint)) {
        showToast("This complaint is already citizen verified.");
        return;
    }

    currentAuthorityComplaintId = id;
    currentAuthorityProofImage = null;
    currentAuthorityCoordinates = null;

    document.getElementById("authorityResolutionForm")?.reset();
    idInput.value = String(id);

    const attempts = getResolutionAttempts(id);
    const review = getCitizenReview(id);

    selected.innerHTML = `
        <div><small>RECORD</small><strong>${escapeHTML(formatComplaintId(id))}</strong></div>
        <div><small>PROBLEM</small><strong>${escapeHTML(getCategoryName(complaint))}</strong></div>
        <div><small>LOCATION</small><strong>${escapeHTML(publicLocation(complaint))}</strong></div>
        <div><small>OPEN</small><strong>${escapeHTML(formatDuration(complaintAgeMs(complaint)))}</strong></div>`;

    originalRecord.innerHTML = `
        <div class="authority-original-heading">
            <small>ORIGINAL RECORD / BEFORE</small>
            <strong>Citizen report</strong>
        </div>
        ${citizenEvidenceMarkup(complaint)}
        <div class="authority-original-copy">
            <span>${escapeHTML(formatDate(complaint.created_at))}</span>
            <p>${escapeHTML(complaint.description || "No description recorded.")}</p>
            <strong>${escapeHTML(publicLocation(complaint))}</strong>
        </div>
        ${attempts.length ? `
            <div class="authority-previous-attempts-note ${isCitizenReopened(complaint) ? "returned" : ""}">
                <small>PREVIOUS HISTORY</small>
                <strong>${attempts.length} RESOLUTION ${attempts.length === 1 ? "ATTEMPT" : "ATTEMPTS"} ALREADY ON RECORD</strong>
                <p>${review?.action === "reopened" || review?.action === "questioned" ? "The latest attempt was returned by a citizen. It will not be erased when you submit another attempt." : "Previous attempts remain inspectable in the public Problem File."}</p>
            </div>` : ""}`;

    const attemptHeading = document.getElementById("authorityAttemptHeading");
    if (attemptHeading) attemptHeading.textContent = `RESOLUTION ATTEMPT ${String(attempts.length + 1).padStart(2, "0")}`;

    const preview = document.getElementById("authorityProofPreview");
    const previewImage = document.getElementById("authorityProofPreviewImage");
    if (preview) preview.hidden = true;
    if (previewImage) previewImage.removeAttribute("src");

    const message = document.getElementById("authorityFormMessage");
    if (message) message.textContent = "";

    updateAuthorityGeoDisplay();
    panel.hidden = false;
    panel.scrollIntoView({ behavior: "smooth", block: "start" });
}

function closeAuthorityAction() {
    const panel = document.getElementById("authorityActionPanel");
    if (panel) panel.hidden = true;
    resetAuthorityActionState();
}

async function handleAuthorityProofImage(event) {
    const file = event.target.files?.[0] || null;
    const message = document.getElementById("authorityFormMessage");

    if (!file) {
        currentAuthorityProofImage = null;
        return;
    }

    if (!file.type.startsWith("image/")) {
        event.target.value = "";
        currentAuthorityProofImage = null;
        if (message) message.textContent = "Select an image file for the solved-problem proof.";
        return;
    }

    if (file.size > 10 * 1024 * 1024) {
        event.target.value = "";
        currentAuthorityProofImage = null;
        if (message) message.textContent = "Image is too large. Maximum size is 10 MB.";
        return;
    }

    currentAuthorityProofImage = file;

    const preview = document.getElementById("authorityProofPreview");
    const image = document.getElementById("authorityProofPreviewImage");

    if (image) image.src = URL.createObjectURL(file);
    if (preview) preview.hidden = false;
    if (message) message.textContent = "After-photo ready for backend upload.";
}

function captureAuthorityGeotag() {
    const message = document.getElementById("authorityFormMessage");
    const status = document.getElementById("authorityGeoStatus");

    if (!navigator.geolocation) {
        if (message) message.textContent = "This browser does not provide geolocation.";
        return;
    }

    if (status) status.textContent = "CAPTURING LOCATION…";

    navigator.geolocation.getCurrentPosition(
        position => {
            currentAuthorityCoordinates = {
                latitude: position.coords.latitude,
                longitude: position.coords.longitude,
                accuracy: position.coords.accuracy,
                capturedAt: new Date().toISOString()
            };
            updateAuthorityGeoDisplay();
            if (message) message.textContent = "Current geotag captured.";
        },
        error => {
            currentAuthorityCoordinates = null;
            updateAuthorityGeoDisplay();
            if (message) message.textContent = error.message || "Could not capture current location.";
        },
        { enableHighAccuracy: true, timeout: 10000, maximumAge: 0 }
    );
}

function reportedCoordinates(complaint) {
    const text = String(complaint?.location || "");
    const match = text.match(/Latitude:\s*(-?\d+(?:\.\d+)?)\s*,\s*Longitude:\s*(-?\d+(?:\.\d+)?)/i);
    if (!match) return null;

    const latitude = Number(match[1]);
    const longitude = Number(match[2]);
    return Number.isFinite(latitude) && Number.isFinite(longitude)
        ? { latitude, longitude }
        : null;
}

function coordinateDistanceMeters(a, b) {
    if (!a || !b) return null;
    const toRad = degrees => degrees * Math.PI / 180;
    const earthRadius = 6371000;
    const lat1 = toRad(Number(a.latitude));
    const lat2 = toRad(Number(b.latitude));
    const deltaLat = toRad(Number(b.latitude) - Number(a.latitude));
    const deltaLon = toRad(Number(b.longitude) - Number(a.longitude));

    const h = Math.sin(deltaLat / 2) ** 2 +
        Math.cos(lat1) * Math.cos(lat2) * Math.sin(deltaLon / 2) ** 2;

    return 2 * earthRadius * Math.atan2(Math.sqrt(h), Math.sqrt(1 - h));
}

function authorityLocationCheck(complaint, proof) {
    const reported = reportedCoordinates(complaint);
    if (!reported) {
        return {
            className: "unknown",
            label: "REPORT PIN NOT AVAILABLE",
            detail: "CITYFILE cannot compare the two locations because this complaint has no stored report coordinates."
        };
    }

    const distance = coordinateDistanceMeters(reported, {
        latitude: Number(proof.latitude),
        longitude: Number(proof.longitude)
    });

    if (!Number.isFinite(distance)) {
        return { className: "unknown", label: "LOCATION CHECK UNAVAILABLE", detail: "Location comparison could not be calculated." };
    }

    if (distance <= 250) {
        return {
            className: "consistent",
            label: "NEAR REPORTED LOCATION",
            detail: `Resolution geotag is about ${Math.round(distance)} m from the original report pin. This supports location consistency; it does not prove the repair itself.`
        };
    }

    return {
        className: "warning",
        label: "LOCATION DIFFERS · REVIEW",
        detail: `Resolution geotag is about ${Math.round(distance)} m from the original report pin. The evidence should be checked before verification.`
    };
}

async function submitAuthorityResolution(event) {
    event.preventDefault();

    const id = Number(
        document.getElementById("authorityComplaintId")?.value ||
        currentAuthorityComplaintId
    );
    const authority = document.getElementById("authorityOfficerName")?.value.trim() || "";
    const note = document.getElementById("authorityActionNote")?.value.trim() || "";
    const message = document.getElementById("authorityFormMessage");
    const submitButton = event.currentTarget?.querySelector('[type="submit"]');

    if (!citykeeperCurrentUser) {
        if (message) message.textContent = "Sign in with an authorized authority account first.";
        await openCitykeeperAuth();
        return;
    }

    if (!citykeeperCurrentUser.is_authority) {
        if (message) message.textContent = "This account is not authorized for authority actions.";
        return;
    }

    if (!Number.isFinite(id) || !authority || !note) {
        if (message) message.textContent = "Complete the authority and work-details fields.";
        return;
    }
    if (!(currentAuthorityProofImage instanceof File)) {
        if (message) message.textContent = "A solved-problem photo is required.";
        return;
    }
    if (!currentAuthorityCoordinates) {
        if (message) message.textContent = "Capture the current geotag before submitting.";
        return;
    }

    if (submitButton) submitButton.disabled = true;

    try {
        const formData = new FormData();
        formData.append("file", currentAuthorityProofImage);
        formData.append("authority_label", authority);
        formData.append("note", note);
        formData.append("latitude", String(currentAuthorityCoordinates.latitude));
        formData.append("longitude", String(currentAuthorityCoordinates.longitude));
        formData.append("accuracy_m", String(currentAuthorityCoordinates.accuracy || ""));
        formData.append("captured_at", currentAuthorityCoordinates.capturedAt || new Date().toISOString());

        const record = await fetchJSON(
            `/authority/complaints/${id}/resolution`,
            { method: "POST", body: formData }
        );

        upsertComplaintRecord(record);
        await loadBackendEvidence(id);
        await loadComplaints({ silent: true });

        const attempts = getResolutionAttempts(id);
        if (message) message.textContent = "Proof published. This record is awaiting citizen verification.";

        showToast(
            `Resolution attempt ${attempts.length || 1} published · awaiting citizen verification.`
        );
        closeAuthorityAction();
        await openCase(id);
    }
    catch (error) {
        console.error("Authority resolution error:", error);
        if (message) message.textContent = error.message || "Could not publish resolution evidence.";
        showToast(error.message || "Could not publish resolution evidence.");
    }
    finally {
        if (submitButton) submitButton.disabled = false;
    }
}

function resolutionAttemptsHistoryHTML(complaint) {
    const attempts = getResolutionAttempts(complaint.complaint_id);
    if (!attempts.length) return "";

    return `
        <div class="resolution-attempt-history">
            <div class="resolution-history-heading">
                <small>PERMANENT RESOLUTION HISTORY</small>
                <strong>${attempts.length} ${attempts.length === 1 ? "ATTEMPT" : "ATTEMPTS"} ON RECORD</strong>
                <p>New attempts are added. Earlier attempts and citizen responses are not replaced.</p>
            </div>
            <div class="resolution-attempt-list">
                ${attempts.map((entry, index) => {
                    const proof = entry.proof || {};
                    const review = entry.review;
                    const reviewLabel = review?.action === "verified"
                        ? "✓ CITIZEN VERIFIED"
                        : review?.action === "reopened"
                            ? "↩ ISSUE STILL EXISTS"
                            : review?.action === "questioned"
                                ? "! PROOF QUESTIONED"
                                : "◌ AWAITING CITIZEN";
                    const reviewClass = review?.action === "verified"
                        ? "verified"
                        : review?.action === "reopened" || review?.action === "questioned"
                            ? "returned"
                            : "pending";

                    return `
                        <article class="resolution-attempt-item ${reviewClass}">
                            <div class="resolution-attempt-number">
                                <span>ATTEMPT</span>
                                <strong>${String(entry.attempt || index + 1).padStart(2, "0")}</strong>
                            </div>
                            <div class="resolution-attempt-body">
                                <small>${escapeHTML(formatDate(proof.capturedAt))}</small>
                                <strong>${escapeHTML(proof.authority || "Authority record")}</strong>
                                <p>${escapeHTML(proof.note || "Resolution action recorded.")}</p>
                                <span class="resolution-attempt-review">${reviewLabel}</span>
                                ${review?.reason ? `<em>${escapeHTML(review.reason)}</em>` : ""}
                            </div>
                        </article>`;
                }).join("")}
            </div>
        </div>`;
}

function verificationLayersHTML(complaint, proof, review) {
    const locationCheck = authorityLocationCheck(complaint, proof);
    const hash = getBlockchainHash(complaint);
    const citizenLabel = review?.action === "verified"
        ? "CITIZEN VERIFIED"
        : review?.action === "reopened" || review?.action === "questioned"
            ? "RETURNED / QUESTIONED"
            : "AWAITING CITIZEN";

    return `
        <div class="verification-layers">
            <div class="verification-layer ${hash ? "positive" : "neutral"}">
                <small>RECORD INTEGRITY</small>
                <strong>${hash ? "HASH-CHAIN ANCHOR RECORDED" : "ANCHOR NOT AVAILABLE"}</strong>
                <p>${hash ? "A SHA-256 link is present in CITYFILE's local tamper-evident integrity chain." : "No local integrity-chain anchor is available on this loaded record."}</p>
            </div>
            <div class="verification-layer positive">
                <small>AUTHORITY EVIDENCE</small>
                <strong>SUBMITTED</strong>
                <p>After-photo, timestamp, geotag and work note are attached to this resolution attempt.</p>
            </div>
            <div class="verification-layer ${locationCheck.className}">
                <small>LOCATION CONSISTENCY</small>
                <strong>${escapeHTML(locationCheck.label)}</strong>
                <p>${escapeHTML(locationCheck.detail)}</p>
            </div>
            <div class="verification-layer ${review?.action === "verified" ? "positive" : review ? "warning" : "neutral"}">
                <small>REAL-WORLD VERDICT</small>
                <strong>${escapeHTML(citizenLabel)}</strong>
                <p>Only a persisted citizen review closes the authority-resolution loop.</p>
            </div>
        </div>`;
}

function authorityProofPublicHTML(complaint) {
    const id = complaint?.complaint_id;
    const proof = getAuthorityProof(id);
    if (!proof) return "";

    const review = getCitizenReview(id);
    const latitude = formatAuthorityCoordinate(proof.latitude);
    const longitude = formatAuthorityCoordinate(proof.longitude);
    const accuracy = Number.isFinite(Number(proof.accuracy)) ? `±${Math.round(Number(proof.accuracy))} m` : "—";
    const locationCheck = authorityLocationCheck(complaint, proof);

    let reviewMarkup = "";
    if (review?.action === "verified") {
        reviewMarkup = `
            <div class="citizen-review-result verified" data-resolution-review="${Number(id)}">
                <small>CITIZEN REVIEW</small>
                <strong>✓ FIX VERIFIED</strong>
                <p>A citizen reviewed the submitted resolution evidence and confirmed the fix.</p>
                <span>${escapeHTML(formatDate(review.timestamp))}</span>
            </div>`;
    }
    else if (review?.action === "reopened" || review?.action === "questioned") {
        reviewMarkup = `
            <div class="citizen-review-result challenged" data-resolution-review="${Number(id)}">
                <small>CITIZEN CHALLENGE</small>
                <strong>↩ RETURNED TO AUTHORITY</strong>
                <p>${escapeHTML(review.reason || "Citizen reported that the issue still exists or the proof is questionable.")}</p>
                <span>${escapeHTML(formatDate(review.timestamp))}</span>
            </div>`;
    }
    else {
        reviewMarkup = `
            <div class="citizen-resolution-review" data-resolution-review="${Number(id)}">
                <small>VERIFY RESOLUTION</small>
                <h4>THE AUTHORITY SAYS THIS IS FIXED.<br>DO YOU AGREE?</h4>
                <p>Compare the original report with the authority's after-evidence. A proof submission does not close this complaint by itself.</p>
                <div class="citizen-review-actions">
                    <button type="button" class="citizen-review-btn verify" onclick="window.reviewAuthorityResolution(${Number(id)}, 'verified')">✓ YES · VERIFY FIX</button>
                    <button type="button" class="citizen-review-btn question" onclick="window.reviewAuthorityResolution(${Number(id)}, 'questioned')">? PROOF IS NOT CLEAR</button>
                    <button type="button" class="citizen-review-btn reopen" onclick="window.reviewAuthorityResolution(${Number(id)}, 'reopened')">↩ NO · ISSUE STILL EXISTS</button>
                </div>
                <p class="citizen-review-privacy">Your response becomes part of this record. Do not include private personal information in a challenge reason.</p>
            </div>`;
    }

    return `
        <section class="case-record-section authority-public-proof">
            <div class="case-section-heading">
                <small>AUTHORITY RESOLUTION EVIDENCE</small>
                <h3>Before → after.</h3>
            </div>

            <div class="before-after-proof">
                <div class="before-after-column before">
                    <div class="before-after-label"><span>BEFORE</span><small>CITIZEN RECORD</small></div>
                    ${citizenEvidenceMarkup(complaint)}
                </div>

                <div class="before-after-arrow" aria-hidden="true">→</div>

                <div class="before-after-column after">
                    <div class="before-after-label"><span>AFTER</span><small>AUTHORITY EVIDENCE</small></div>
                    <div class="authority-proof-media">
                        <img src="${escapeHTML(publicFileURL(proof.image))}" alt="Authority submitted photograph showing the civic problem after repair" class="authority-proof-public-image">
                        <div class="authority-proof-geotag-stamp">
                            <span>GEOTAGGED RESOLUTION EVIDENCE</span>
                            <strong>${escapeHTML(latitude)}, ${escapeHTML(longitude)}</strong>
                            <small>${escapeHTML(formatDate(proof.capturedAt))}</small>
                        </div>
                    </div>
                </div>
            </div>

            <div class="authority-proof-public-panel">
                <div class="authority-proof-details">
                    <div><span>AUTHORITY / OFFICER</span><strong>${escapeHTML(proof.authority || "Authority record")}</strong></div>
                    <div><span>CAPTURED AT</span><strong>${escapeHTML(formatDate(proof.capturedAt))}</strong></div>
                    <div><span>GEOTAG</span><strong>${escapeHTML(latitude)}, ${escapeHTML(longitude)}</strong></div>
                    <div><span>LOCATION ACCURACY</span><strong>${escapeHTML(accuracy)}</strong></div>
                </div>

                <div class="authority-location-check ${locationCheck.className}">
                    <span>LOCATION CHECK</span>
                    <strong>${escapeHTML(locationCheck.label)}</strong>
                    <p>${escapeHTML(locationCheck.detail)}</p>
                </div>

                <div class="authority-work-note">
                    <span>WORK COMPLETED</span>
                    <p>${escapeHTML(proof.note || "Resolution work recorded by the responsible authority.")}</p>
                </div>
            </div>

            ${verificationLayersHTML(complaint, proof, review)}
            ${reviewMarkup}
            ${resolutionAttemptsHistoryHTML(complaint)}
        </section>`;
}

async function reviewAuthorityResolution(complaintId, action) {
    const id = Number(complaintId);
    const complaint = complaintById(id);
    const proof = getAuthorityProof(id);

    if (!complaint || !proof) {
        showToast("There is no authority resolution proof to review yet.");
        return;
    }

    if (!citykeeperCurrentUser) {
        showToast("Sign in as a citizen before verifying a resolution.");
        await openCitykeeperAuth();
        return;
    }

    if (citykeeperCurrentUser.is_authority) {
        showToast("Authority accounts cannot perform the citizen verification step.");
        return;
    }

    let reason = "";

    if (action === "verified") {
        const confirmed = window.confirm(
            "Verify this fix?\n\nThis records that you reviewed the authority's evidence and believe the civic problem has been fixed."
        );
        if (!confirmed) return;
        reason = "Citizen confirmed that the submitted proof matches the fixed real-world condition.";
    }
    else if (action === "questioned") {
        const response = window.prompt(
            "Why is this proof unclear or questionable?\n\nFor example: wrong location, unclear repair, or evidence does not show the reported problem."
        );
        if (response === null) return;
        reason = response.trim();
        if (!reason) {
            showToast("Please explain why the resolution proof is questionable.");
            return;
        }
    }
    else if (action === "reopened") {
        const response = window.prompt(
            "Tell the authority what still exists.\n\nDo not include private personal information."
        );
        if (response === null) return;
        reason = response.trim();
        if (!reason) {
            showToast("Please briefly explain why the issue still exists.");
            return;
        }
    }
    else {
        return;
    }

    try {
        const result = await fetchJSON(
            `/complaints/${id}/resolution-review`,
            {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ decision: action, reason })
            }
        );

        if (result?.complaint) upsertComplaintRecord(result.complaint);
        await loadComplaints({ silent: true });

        showToast(
            action === "verified"
                ? "Resolution citizen verified."
                : "Resolution returned to the authority queue. Previous proof remains on record."
        );

        await openCase(id);
    }
    catch (error) {
        console.error("Citizen resolution review error:", error);
        showToast(error.message || "Could not save citizen verification.");
    }
}

async function openCitizenVerification(complaintId) {
    const id = Number(complaintId);
    await openCase(id);

    setTimeout(() => {
        document.querySelector(`[data-resolution-review="${id}"]`)?.scrollIntoView({
            behavior: "smooth",
            block: "center"
        });
    }, 80);
}

async function updateAuthorityStatus(complaintId, status) {
    const id = Number(complaintId);

    if (!citykeeperCurrentUser) {
        showToast("Sign in with an authorized authority account first.");
        await openCitykeeperAuth();
        return;
    }

    if (!citykeeperCurrentUser.is_authority) {
        showToast("This account is not authorized for authority actions.");
        return;
    }

    try {
        const record = await fetchJSON(`/complaints/${id}`, {
            method: "PUT",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ status })
        });

        upsertComplaintRecord(record);
        await loadComplaints({ silent: true });
        showToast(`Record ${formatComplaintId(id)} → ${status}.`);
    }
    catch (error) {
        console.error("Authority status update error:", error);
        showToast(error.message || "Could not update authority status.");
    }
}

async function updateAuthorityDeadline(complaintId) {
    const id = Number(complaintId);

    if (!citykeeperCurrentUser) {
        showToast("Sign in with an authorized authority account first.");
        await openCitykeeperAuth();
        return;
    }

    if (!citykeeperCurrentUser.is_authority) {
        showToast("This account is not authorized for authority actions.");
        return;
    }

    const complaint = complaintById(id);
    const existing = complaint?.deadline
        ? new Date(complaint.deadline).toISOString().slice(0, 16)
        : "";
    const raw = window.prompt(
        "Set the authority deadline (YYYY-MM-DDTHH:MM).",
        existing
    );

    if (raw === null) return;

    const parsed = new Date(raw);
    if (!Number.isFinite(parsed.getTime())) {
        showToast("Enter a valid deadline date and time.");
        return;
    }

    try {
        const record = await fetchJSON(`/complaints/${id}`, {
            method: "PUT",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ deadline: parsed.toISOString() })
        });

        upsertComplaintRecord(record);
        await loadComplaints({ silent: true });
        showToast(`Deadline updated for ${formatComplaintId(id)}.`);
    }
    catch (error) {
        console.error("Authority deadline update error:", error);
        showToast(error.message || "Could not update the deadline.");
    }
}


function initializeAuthorityDashboard() {
    document.getElementById("authorityClosePanel")?.addEventListener("click", closeAuthorityAction);
    document.getElementById("authorityCaptureGeo")?.addEventListener("click", captureAuthorityGeotag);
    document.getElementById("authorityProofImage")?.addEventListener("change", handleAuthorityProofImage);
    document.getElementById("authorityResolutionForm")?.addEventListener("submit", submitAuthorityResolution);

    document.getElementById("authorityCategoryGrid")?.addEventListener("click", event => {
    const card = event.target.closest("[data-authority-category]");

    if (!card) return;

    // Set the selected problem category
    activeAuthorityCategory =
        card.dataset.authorityCategory || "all";

    // Re-render the Priority Queue using this category
    renderAuthorityDashboard();

    // Move the user directly to the filtered problems
    requestAnimationFrame(() => {
        const queue =
            document.getElementById("authorityComplaintGrid");

        if (!queue) return;

        const header =
            document.querySelector(".site-header");

        const headerHeight =
            header?.offsetHeight || 0;

        const targetTop =
            queue.getBoundingClientRect().top +
            window.pageYOffset -
            headerHeight -
            90;

        window.scrollTo({
            top: targetTop,
            behavior: "smooth"
        });
    });
});

    document.getElementById("authorityStatusFilters")?.addEventListener("click", event => {
        const button = event.target.closest("[data-authority-status]");
        if (!button) return;
        activeAuthorityStatus = button.dataset.authorityStatus || "all";
        renderAuthorityDashboard();
    });

    document.getElementById("authoritySearch")?.addEventListener("input", event => {
        authoritySearchTerm = event.target.value || "";
        renderAuthorityDashboard();
    });

    document.getElementById("authoritySort")?.addEventListener("change", event => {
        authoritySortOrder = event.target.value === "newest" ? "newest" : "oldest";
        renderAuthorityDashboard();
    });
}
/* ============================================================
   CITYKEEPERS — COMMUNITY ACTION FRONTEND
   Uses live complaint records, authenticated participation and backend verification.
   ============================================================ */

function getCitykeeperState() {
    const joined = {};

    for (
        const participation of
        citykeeperParticipations
    ) {
        joined[
            String(
                participation.complaint_id
            )
        ] = {
            participationId:
                participation.participation_id,
            joinedAt:
                participation.joined_at
        };
    }

    const evidence = {};

    for (
        const item of (
            citykeeperProfileData?.trail ||
            []
        )
    ) {
        if (!item.evidence_id) {
            continue;
        }

        evidence[
            String(
                item.complaint_id
            )
        ] = {
            evidenceId:
                item.evidence_id,
            submittedAt:
                item.evidence_submitted_at,
            verificationDecision:
                item.verification_decision
        };
    }

    return {
        citykeeperId:
            citykeeperCurrentUser
                ?.public_user_id ||
            "SIGN IN",
        joined,
        evidence
    };
}


function saveCitykeeperState() {
    // CITYKEEPERS state is backend-driven now.
    // Kept as a no-op only for compatibility with
    // any old event path that may still call it.
    return true;
}

function communityComplaintText(complaint) {
    return [
        getCategoryName(complaint),
        getDepartmentName(complaint),
        complaint?.description,
        complaint?.location
    ]
        .filter(Boolean)
        .join(" ")
        .toLowerCase();
}

function isCommunityEligible(complaint) {
    if (!complaint) {
        return false;
    }

    if (typeof complaint.citykeeper_eligible === "boolean") {
        return complaint.citykeeper_eligible;
    }

    const group = issueGroup(complaint);
    const text = communityComplaintText(complaint);

    /*
     * IMPORTANT:
     * Do NOT remove a complaint merely because its
     * Citykeeper contribution has been verified.
     *
     * Verified community work must remain visible
     * as part of CITYFILE's permanent civic record.
     */

    // Infrastructure/safety work stays with trained authorities.
    if (
        [
            "road",
            "water",
            "drainage",
            "streetlight",
            "safety"
        ].includes(group)
    ) {
        return false;
    }

    if (group === "sanitation") {
        return true;
    }

    return /park|garden|public space|litter|garbage|trash|waste|graffiti|wall|tree|plant|clean(?:ing|up)?|playground|community space/.test(
        text
    );
}

function communityMissionType(complaint) {
    const text = communityComplaintText(complaint);

    if (/graffiti|wall|paint/.test(text)) return "PUBLIC SPACE RESTORATION";
    if (/tree|plant|garden|park/.test(text)) return "PUBLIC SPACE CARE";
    if (/garbage|trash|waste|litter|clean/.test(text)) return "COMMUNITY CLEANUP";

    return "COMMUNITY ACTION";
}


function communityMissionResources(complaint) {
    const text = communityComplaintText(complaint);

    if (/graffiti|wall|paint/.test(text)) {
        return ["PEOPLE", "GLOVES", "CLEANUP TOOLS"];
    }

    if (/tree|plant|garden|park/.test(text)) {
        return ["PEOPLE", "GLOVES", "CARE TOOLS"];
    }

    return ["PEOPLE", "GLOVES", "WASTE BAGS"];
}


function communityVisualKind(complaint) {
    const text = communityComplaintText(complaint);

    if (/tree|plant|garden|park/.test(text)) return "park";
    if (/graffiti|wall|paint/.test(text)) return "wall";
    return "cleanup";
}


function communityFallbackVisualMarkup(complaint) {
    const kind = communityVisualKind(complaint);

    if (kind === "park") {
        return `
            <div class="ck-scene ck-scene-park" aria-hidden="true">
                <span class="ck-moon"></span>
                <span class="ck-tree tree-one"></span>
                <span class="ck-tree tree-two"></span>
                <span class="ck-bench"></span>
                <span class="ck-ground-mark mark-one"></span>
                <span class="ck-ground-mark mark-two"></span>
            </div>`;
    }

    if (kind === "wall") {
        return `
            <div class="ck-scene ck-scene-wall" aria-hidden="true">
                <span class="ck-wall-plane"></span>
                <span class="ck-wall-mark mark-a"></span>
                <span class="ck-wall-mark mark-b"></span>
                <span class="ck-paint-can"></span>
            </div>`;
    }

    return `
        <div class="ck-scene ck-scene-cleanup" aria-hidden="true">
            <span class="ck-city-line"></span>
            <span class="ck-bin-visual"></span>
            <span class="ck-trash-shape trash-a"></span>
            <span class="ck-trash-shape trash-b"></span>
            <span class="ck-trash-shape trash-c"></span>
            <span class="ck-street-glow"></span>
        </div>`;
}


function latestCitykeeperEvidenceForComplaint(complaintId) {
    const id = Number(complaintId);
    const evidenceList = backendEvidenceCache.get(id) || [];

    return evidenceList
        .filter(item => item?.evidence_type === "citykeeper_after")
        .slice()
        .sort((a, b) => {
            const aTime = Date.parse(a?.uploaded_at || "") || 0;
            const bTime = Date.parse(b?.uploaded_at || "") || 0;
            if (aTime !== bTime) return bTime - aTime;
            return Number(b?.evidence_id || 0) - Number(a?.evidence_id || 0);
        })[0] || null;
}

function communityEvidenceImage(complaint) {

    const complaintId =
        Number(complaint?.complaint_id);

    const evidenceList =
        backendEvidenceCache.get(complaintId) || [];

    const citizenEvidence =
        evidenceList.find(
            evidence =>
                evidence.evidence_type === "citizen_report"
        );

    if (!citizenEvidence?.file_url) {
        return "";
    }

    return citizenEvidence.file_url.startsWith("http")
        ? citizenEvidence.file_url
        : `${API_BASE_URL}${citizenEvidence.file_url}`;
}

function citykeeperMissionRecords() {
    return allComplaints
        .filter(isCommunityEligible)
        .filter(complaint => {
            const id = Number(
                complaint.complaint_id
            );

            const evidenceList =
                backendEvidenceCache.get(id) || [];

            const evidence = latestCitykeeperEvidenceForComplaint(id);

            const verification =
                citykeeperVerificationCache.get(id) ||
                null;

            const verified =
                Boolean(
                    evidence &&
                    verification &&
                    Number(
                        verification.evidence_id
                    ) ===
                        Number(
                            evidence.evidence_id
                        ) &&
                    String(
                        verification.decision || ""
                    ).toLowerCase() ===
                        "verified"
                );

            // OPEN MISSIONS ONLY
            return !verified;
        })
        .slice()
        .sort(
            (a, b) =>
                complaintAgeMs(b) -
                complaintAgeMs(a)
        );
}

function citykeeperVerifiedRecords() {
    return allComplaints
        .filter(isCommunityEligible)
        .filter(complaint => {
            const id = Number(
                complaint.complaint_id
            );

            const evidenceList =
                backendEvidenceCache.get(id) || [];

            const evidence = latestCitykeeperEvidenceForComplaint(id);

            const verification =
                citykeeperVerificationCache.get(id) ||
                null;

            return Boolean(
                evidence &&
                verification &&
                Number(
                    verification.evidence_id
                ) ===
                    Number(
                        evidence.evidence_id
                    ) &&
                String(
                    verification.decision || ""
                ).toLowerCase() ===
                    "verified"
            );
        })
        .slice()
        .sort((a, b) => {
            const aVerification =
                citykeeperVerificationCache.get(
                    Number(a.complaint_id)
                );

            const bVerification =
                citykeeperVerificationCache.get(
                    Number(b.complaint_id)
                );

            const aTime =
                Date.parse(
                    aVerification?.created_at || ""
                ) || 0;

            const bTime =
                Date.parse(
                    bVerification?.created_at || ""
                ) || 0;

            return bTime - aTime;
        });
}

function renderCitykeeperMissionCard(complaint, state) {
    const id = Number(
        complaint.complaint_id
    );

    const joined = Boolean(
        state.joined[
            String(id)
        ]
    );

    const evidenceList =
        backendEvidenceCache.get(
            id
        ) || [];

    const evidence = latestCitykeeperEvidenceForComplaint(id);

    const verification =
        citykeeperVerificationCache.get(
            id
        ) || null;

    const verifiedContribution =
        Boolean(
            evidence &&
            verification &&
            Number(
                verification.evidence_id
            ) ===
                Number(
                    evidence.evidence_id
                ) &&
            String(
                verification.decision
            ).toLowerCase() ===
                "verified"
        );

    const rejectedContribution =
        Boolean(
            evidence &&
            verification &&
            Number(
                verification.evidence_id
            ) ===
                Number(
                    evidence.evidence_id
                ) &&
            String(
                verification.decision
            ).toLowerCase() ===
                "rejected"
        );

    const ownContribution =
        Boolean(
            evidence &&
            citykeeperCurrentUser &&
            Number(
                evidence.uploaded_by_user
            ) ===
                Number(
                    citykeeperCurrentUser.user_id
                )
        );

    const image =
        communityEvidenceImage(
            complaint
        );

    const missionStats =
        citykeeperMissionStatsCache.get(
            id
        ) || {};

    const participantCount =
        Number(
            missionStats.participant_count ||
            0
        );

    let localState =
        "OPEN TO CITYKEEPERS";

    if (verifiedContribution) {
        localState =
            ownContribution
                ? "YOUR IMPACT · VERIFIED"
                : "COMMUNITY IMPACT · VERIFIED";
    }
    else if (rejectedContribution) {
        localState =
            ownContribution
                ? "YOUR PROOF NEEDS A RETRY"
                : "NEW PROOF NEEDED";
    }
    else if (evidence) {
        localState =
            ownContribution
                ? "YOUR EVIDENCE · AWAITING VERIFICATION"
                : "EVIDENCE · AWAITING VERIFICATION";
    }
    else if (joined) {
        localState =
            "YOU JOINED THIS MISSION";
    }

    const footerLabel =
        participantCount > 0
            ? `${participantCount} ${
                participantCount === 1
                    ? "CITYKEEPER"
                    : "CITYKEEPERS"
              } JOINED`
            : "OPEN COMMUNITY FILE";

    return `
        <article
            class="
                citykeeper-mission-card
                ${joined ? "joined" : ""}
                ${verifiedContribution ? "verified" : ""}
            "
            data-citykeeper-mission="${id}"
        >

            <button
                type="button"
                class="citykeeper-mission-open"
                data-open-citykeeper-mission="${id}"
                aria-label="Open ${escapeHTML(
                    getCategoryName(
                        complaint
                    )
                )} community mission"
            >

                <div
                    class="
                        citykeeper-mission-media
                        ${image ? "has-image" : ""}
                    "
                >

                    ${
                        image
                            ? `
                                <img
                                    src="${escapeHTML(
                                        image
                                    )}"
                                    alt="Citizen evidence for ${escapeHTML(
                                        getCategoryName(
                                            complaint
                                        )
                                    )}"
                                >
                            `
                            : communityFallbackVisualMarkup(
                                complaint
                            )
                    }

                    <span class="citykeeper-safe-stamp">
                        COMMUNITY-SAFE
                    </span>

                    <span class="citykeeper-record-stamp">
                        ${escapeHTML(
                            formatComplaintId(
                                id
                            )
                        )}
                    </span>

                    <span
                        class="citykeeper-media-scan"
                        aria-hidden="true"
                    ></span>

                </div>


                <div class="citykeeper-mission-copy">

                    <div class="citykeeper-mission-topline">

                        <small>
                            ${escapeHTML(
                                communityMissionType(
                                    complaint
                                )
                            )}
                        </small>

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


                    <h4>
                        ${escapeHTML(
                            getCategoryName(
                                complaint
                            )
                        )}
                    </h4>


                    <p>
                        ${escapeHTML(
                            publicLocation(
                                complaint
                            )
                        )}
                    </p>


                    <div class="citykeeper-mission-state">

                        <span></span>

                        <strong>
                            ${escapeHTML(
                                localState
                            )}
                        </strong>

                    </div>


                    <div class="citykeeper-mission-footer">

                        <span>
                            ${escapeHTML(
                                footerLabel
                            )}
                        </span>

                        <b>
                            ↗
                        </b>

                    </div>

                </div>

            </button>

        </article>
    `;
}

function renderCitykeeperVerifiedCard(complaint) {
    const id = Number(
        complaint.complaint_id
    );

    const evidenceList =
        backendEvidenceCache.get(id) || [];

    const beforeEvidence =
        evidenceList.find(
            item =>
                item.evidence_type ===
                "citizen_report"
        ) || null;

    const afterEvidence =
        latestCitykeeperEvidenceForComplaint(id);

    const verification =
        citykeeperVerificationCache.get(id) ||
        null;


    const beforeImage =
        beforeEvidence?.file_url
            ? (
                beforeEvidence.file_url.startsWith("http")
                    ? beforeEvidence.file_url
                    : `${API_BASE_URL}${beforeEvidence.file_url}`
              )
            : "";


    const afterImage =
        afterEvidence?.file_url
            ? (
                afterEvidence.file_url.startsWith("http")
                    ? afterEvidence.file_url
                    : `${API_BASE_URL}${afterEvidence.file_url}`
              )
            : "";


    return `
        <article
            class="citykeeper-verified-card"
            data-citykeeper-mission="${id}"
        >

            <button
                type="button"
                class="citykeeper-verified-open"
                data-open-citykeeper-mission="${id}"
            >

                <div class="citykeeper-impact-images">

                    <div class="citykeeper-impact-image">
                        ${
                            beforeImage
                                ? `
                                    <img
                                        src="${escapeHTML(beforeImage)}"
                                        alt="Original citizen evidence"
                                    >
                                `
                                : `
                                    <div class="citykeeper-impact-no-image">
                                        NO BEFORE IMAGE
                                    </div>
                                `
                        }

                        <span>BEFORE</span>
                    </div>


                    <div class="citykeeper-impact-arrow">
                        →
                    </div>


                    <div class="citykeeper-impact-image">
                        ${
                            afterImage
                                ? `
                                    <img
                                        src="${escapeHTML(afterImage)}"
                                        alt="Citykeeper action evidence"
                                    >
                                `
                                : `
                                    <div class="citykeeper-impact-no-image">
                                        NO AFTER IMAGE
                                    </div>
                                `
                        }

                        <span>AFTER</span>
                    </div>

                </div>


                <div class="citykeeper-verified-copy">

                    <div class="citykeeper-verified-topline">
                        <span>
                            ${escapeHTML(
                                formatComplaintId(id)
                            )}
                        </span>

                        <strong>
                            ✓ VERIFIED COMMUNITY IMPACT
                        </strong>
                    </div>


                    <h4>
                        ${escapeHTML(
                            getCategoryName(
                                complaint
                            )
                        )}
                    </h4>


                    <p>
                        ${escapeHTML(
                            publicLocation(
                                complaint
                            )
                        )}
                    </p>


                    <div class="citykeeper-verified-meta">

                        <span>
                            CITIZENS ACTED
                        </span>

                        <span>
                            VERIFIED
                            ${
                                verification?.created_at
                                    ? ` · ${escapeHTML(
                                        formatDate(
                                            verification.created_at
                                        )
                                    )}`
                                    : ""
                            }
                        </span>

                    </div>


                    <div class="citykeeper-verified-footer">
                        <span>
                            VIEW IMPACT RECORD
                        </span>

                        <b>↗</b>
                    </div>

                </div>

            </button>

        </article>
    `;
}

function renderCitykeeperVerifiedImpact() {
    const section =
        document.getElementById(
            "citykeeperVerifiedImpact"
        );

    const grid =
        document.getElementById(
            "citykeeperVerifiedGrid"
        );

    const label =
        document.getElementById(
            "citykeeperVerifiedImpactLabel"
        );


    if (!section || !grid) {
        return;
    }


    const records =
        citykeeperVerifiedRecords();


    if (label) {
        label.textContent =
            records.length
                ? `${records.length} ${
                    records.length === 1
                        ? "PROBLEM"
                        : "PROBLEMS"
                  } IMPROVED BY CITIZENS`
                : "NO VERIFIED COMMUNITY IMPACT YET";
    }


    if (!records.length) {
        grid.innerHTML = `
            <div class="citykeeper-empty-missions">

                <span class="citykeeper-empty-symbol">
                    CK
                </span>

                <div>
                    <small>
                        THE RECORD IS WAITING
                    </small>

                    <strong>
                        No verified citizen impact yet.
                    </strong>

                    <p>
                        When Citykeepers act and another
                        citizen verifies the evidence,
                        that impact will remain visible here.
                    </p>
                </div>

            </div>
        `;

        return;
    }


    grid.innerHTML =
        records
            .map(
                complaint =>
                    renderCitykeeperVerifiedCard(
                        complaint
                    )
            )
            .join("");
}

function renderCitykeeperMissions(state) {
    const grid = document.getElementById("citykeeperMissionGrid");
    const count = document.getElementById("citykeeperMissionCount");
    const label = document.getElementById("citykeeperOpenMissionLabel");
    const ring = document.getElementById("citykeepersSignalRing");

    if (!grid) return;

    const records = citykeeperMissionRecords();

    if (count) count.textContent = records.length.toLocaleString("en-IN");

    if (label) {
        label.textContent = records.length
            ? `${records.length} COMMUNITY-SAFE ${records.length === 1 ? "FILE IS" : "FILES ARE"} OPEN`
            : "NO COMMUNITY-SAFE FILES ARE OPEN RIGHT NOW";
    }

    if (ring) {
        const signal = Math.min(100, Math.max(8, records.length * 18));
        ring.style.setProperty("--ck-signal", `${signal * 3.6}deg`);
    }

    if (!records.length) {
        grid.innerHTML = `
            <div class="citykeeper-empty-missions">
                <span class="citykeeper-empty-symbol">CF</span>
                <div>
                    <small>NO MISSION TO DISPLAY</small>
                    <strong>The community queue is clear.</strong>
                    <p>Infrastructure files remain with authorities. New community-safe reports will appear here automatically.</p>
                </div>
            </div>`;
        return;
    }

    grid.innerHTML = records
        .map(complaint => renderCitykeeperMissionCard(complaint, state))
        .join("");
}
function citykeeperContributionStatus(complaint, state) {
    const complaintId =
        Number(complaint.complaint_id);

    const key =
        String(complaintId);

    const joined =
        state.joined[key];


    // =====================================================
    // REAL CITYKEEPER EVIDENCE
    // =====================================================

    const evidenceList =
        backendEvidenceCache.get(
            complaintId
        ) || [];

    const evidence = latestCitykeeperEvidenceForComplaint(id);


    // =====================================================
    // REAL CITYKEEPER VERIFICATION
    // =====================================================

    const verification =
        citykeeperVerificationCache.get(
            complaintId
        ) || null;

    const verified =
        Boolean(
            evidence &&
            verification &&
            Number(verification.evidence_id) ===
                Number(evidence.evidence_id) &&
            String(
                verification.decision
            ).toLowerCase() === "verified"
        );

    const rejected =
        Boolean(
            evidence &&
            verification &&
            Number(verification.evidence_id) ===
                Number(evidence.evidence_id) &&
            String(
                verification.decision
            ).toLowerCase() === "rejected"
        );


    // =====================================================
    // STATUS
    // =====================================================

    if (verified) {
        return {
            label:
                "VERIFIED COMMUNITY IMPACT",

            className:
                "verified",

            time:
                verification.created_at ||
                evidence.uploaded_at ||
                joined?.joinedAt ||
                complaint.created_at
        };
    }


    if (rejected) {
        return {
            label:
                "EVIDENCE NOT VERIFIED",

            className:
                "rejected",

            time:
                verification.created_at ||
                evidence.uploaded_at ||
                joined?.joinedAt ||
                complaint.created_at
        };
    }


    if (evidence) {
        return {
            label:
                "AWAITING CITIZEN VERIFICATION",

            className:
                "evidence",

            time:
                evidence.uploaded_at ||
                joined?.joinedAt ||
                complaint.created_at
        };
    }


    return {
        label:
            "MISSION JOINED",

        className:
            "joined",

        time:
            joined?.joinedAt ||
            complaint.created_at
    };
}

function renderCitykeeperProfile(state = getCitykeeperState()) {
    const profileId =
        document.getElementById(
            "citykeeperProfileId"
        );

    const joinedCount =
        document.getElementById(
            "citykeeperJoinedCount"
        );

    const evidenceCount =
        document.getElementById(
            "citykeeperEvidenceCount"
        );

    const verifiedCount =
        document.getElementById(
            "citykeeperVerifiedCount"
        );

    const status =
        document.getElementById(
            "citykeeperProfileStatus"
        );

    const trail =
        document.getElementById(
            "citykeeperTrail"
        );

    const impactRing =
        document.getElementById(
            "citykeeperImpactRing"
        );

    const impactPercent =
        document.getElementById(
            "citykeeperImpactPercent"
        );


    // =====================================================
    // JOINED MISSIONS
    // =====================================================

    const joinedIds =
        Object.keys(
            state.joined || {}
        );


    // =====================================================
    // REAL BACKEND CITYKEEPER EVIDENCE
    // =====================================================

    const evidenceIds =
        joinedIds.filter(id => {

            const evidenceList =
                backendEvidenceCache.get(
                    Number(id)
                ) || [];

            return evidenceList.some(
                item =>
                    item.evidence_type ===
                    "citykeeper_after"
            );
        });


    // =====================================================
    // REAL CITYKEEPER VERIFICATIONS
    // =====================================================

    const verifiedIds =
        evidenceIds.filter(id => {

            const evidenceList =
                backendEvidenceCache.get(
                    Number(id)
                ) || [];

            const evidence =
                latestCitykeeperEvidenceForComplaint(id);

            const verification =
                citykeeperVerificationCache.get(
                    Number(id)
                );

            return Boolean(
                evidence &&
                verification &&
                Number(
                    verification.evidence_id
                ) ===
                    Number(
                        evidence.evidence_id
                    ) &&
                String(
                    verification.decision
                ).toLowerCase() ===
                    "verified"
            );
        });


    // =====================================================
    // PROFILE COUNTERS
    // =====================================================

    if (profileId) {
        profileId.textContent =
            state.citykeeperId;
    }

    if (joinedCount) {
        joinedCount.textContent =
            joinedIds.length.toLocaleString(
                "en-IN"
            );
    }

    if (evidenceCount) {
        evidenceCount.textContent =
            evidenceIds.length.toLocaleString(
                "en-IN"
            );
    }

    if (verifiedCount) {
        verifiedCount.textContent =
            verifiedIds.length.toLocaleString(
                "en-IN"
            );
    }


    // =====================================================
    // PROFILE STATUS
    // =====================================================

    if (status) {
        status.textContent =
            verifiedIds.length
                ? "VERIFIED CITYKEEPER"
                : evidenceIds.length
                    ? "IMPACT AWAITING VERIFICATION"
                    : joinedIds.length
                        ? "MISSION ACTIVE"
                        : "READY TO HELP";
    }


    // =====================================================
    // IMPACT PERCENTAGE
    // =====================================================

    const percent =
        evidenceIds.length
            ? Math.round(
                (
                    verifiedIds.length /
                    evidenceIds.length
                ) * 100
            )
            : 0;


    if (impactRing) {
        impactRing.style.setProperty(
            "--ck-impact",
            `${percent * 3.6}deg`
        );
    }

    if (impactPercent) {
        impactPercent.textContent =
            `${percent}%`;
    }


    // =====================================================
    // IMPACT TRAIL
    // =====================================================

    if (!trail) {
        return;
    }


    const trailRecords =
        joinedIds

            .map(id =>
                allComplaints.find(
                    item =>
                        String(
                            item.complaint_id
                        ) === String(id)
                )
            )

            .filter(Boolean)

            .map(complaint => ({
                complaint,

                status:
                    citykeeperContributionStatus(
                        complaint,
                        state
                    )
            }))

            .sort(
                (a, b) =>
                    Date.parse(
                        b.status.time || ""
                    ) -
                    Date.parse(
                        a.status.time || ""
                    )
            );


    if (!trailRecords.length) {

        trail.innerHTML = `
            <div class="citykeeper-empty-trail">

                <span>00</span>

                <div>

                    <strong>
                        NO MARKS YET.
                    </strong>

                    <p>
                        Your first joined community mission
                        will begin your Citykeeper trail.
                    </p>

                </div>

            </div>
        `;

        return;
    }


    trail.innerHTML =
        trailRecords

            .map(
                (
                    {
                        complaint,
                        status: itemStatus
                    },
                    index
                ) => `

                <button
                    type="button"
                    class="
                        citykeeper-trail-item
                        ${itemStatus.className}
                    "
                    data-open-citykeeper-mission="${
                        Number(
                            complaint.complaint_id
                        )
                    }"
                >

                    <span
                        class="citykeeper-trail-node"
                    >
                        ${
                            String(
                                index + 1
                            ).padStart(
                                2,
                                "0"
                            )
                        }
                    </span>

                    <span
                        class="citykeeper-trail-line"
                        aria-hidden="true"
                    ></span>

                    <span
                        class="citykeeper-trail-body"
                    >

                        <small>
                            ${escapeHTML(
                                formatDate(
                                    itemStatus.time
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

                        <i>
                            ${escapeHTML(
                                formatComplaintId(
                                    complaint.complaint_id
                                )
                            )}
                            ·
                            ${escapeHTML(
                                publicLocation(
                                    complaint
                                )
                            )}
                        </i>

                    </span>

                    <b>
                        ${escapeHTML(
                            itemStatus.label
                        )}
                    </b>

                </button>
            `
            )

            .join("");
}

function citykeeperHallEntry(state) {

    const joinedIds =
        Object.keys(
            state.joined || {}
        );


    // =====================================================
    // FIND REAL VERIFIED CITYKEEPER CONTRIBUTIONS
    // =====================================================

    const verifiedContributions = [];


    for (const id of joinedIds) {

        const complaintId =
            Number(id);

        const evidenceList =
            backendEvidenceCache.get(
                complaintId
            ) || [];

        const evidence =
            latestCitykeeperEvidenceForComplaint(complaintId);

        if (!evidence) {
            continue;
        }


        const verification =
            citykeeperVerificationCache.get(
                complaintId
            );


        const verified =
            Boolean(
                verification &&
                Number(
                    verification.evidence_id
                ) ===
                    Number(
                        evidence.evidence_id
                    ) &&
                String(
                    verification.decision
                ).toLowerCase() ===
                    "verified"
            );


        if (!verified) {
            continue;
        }


        verifiedContributions.push({
            complaintId:
                complaintId,

            evidence:
                evidence,

            verification:
                verification,

            time:
                verification.created_at ||
                evidence.uploaded_at
        });
    }


    if (!verifiedContributions.length) {
        return null;
    }


    // =====================================================
    // MONTH FILTER
    // =====================================================

    const now =
        new Date();


    const currentMonthVerified =
        verifiedContributions.filter(
            contribution => {

                if (!contribution.time) {
                    return false;
                }

                const date =
                    new Date(
                        contribution.time
                    );

                return (
                    date.getFullYear() ===
                        now.getFullYear() &&

                    date.getMonth() ===
                        now.getMonth()
                );
            }
        );


    const selectedContributions =
        citykeeperHallPeriod === "month"
            ? currentMonthVerified
            : verifiedContributions;


    if (!selectedContributions.length) {
        return null;
    }


    // =====================================================
    // TOTAL REAL EVIDENCE COUNT
    // =====================================================

    const evidenceCount =
        joinedIds.filter(id => {

            const evidenceList =
                backendEvidenceCache.get(
                    Number(id)
                ) || [];

            return evidenceList.some(
                item =>
                    item.evidence_type ===
                    "citykeeper_after"
            );
        }).length;


    return {
        id:
            state.citykeeperId,

        verified:
            selectedContributions.length,

        evidence:
            evidenceCount,

        joined:
            joinedIds.length
    };
}


function renderCitykeeperHall() {
    const podium =
        document.getElementById(
            "citykeeperPodium"
        );

    const leaderboard =
        document.getElementById(
            "citykeeperLeaderboard"
        );

    if (
        !podium ||
        !leaderboard
    ) {
        return;
    }

    const entries =
        Array.isArray(
            citykeeperLeaderboardData
        )
            ? citykeeperLeaderboardData
            : [];

    const emptySlot = (
        rank,
        label
    ) => `
        <div
            class="citykeeper-podium-slot empty rank-${rank}"
        >
            <span class="podium-rank">
                0${rank}
            </span>

            <div class="podium-medallion">
                <span>?</span>
            </div>

            <strong>
                ${escapeHTML(label)}
            </strong>

            <small>
                THIS PLACE IS EARNED
            </small>

            <i>
                verified community impact only
            </i>
        </div>
    `;

    const podiumSlot = (
        entry,
        rank
    ) => {
        if (!entry) {
            return emptySlot(
                rank,
                rank === 1
                    ? "FIRST VERIFIED CITYKEEPER"
                    : rank === 2
                        ? "SECOND MARK"
                        : "THIRD MARK"
            );
        }

        const publicId =
            String(
                entry.public_user_id ||
                "CITYKEEPER"
            );

        const medallion =
            publicId
                .replace(
                    /^CK-/i,
                    ""
                )
                .slice(
                    -4
                ) || "CF";

        const current =
            citykeeperCurrentUser &&
            publicId ===
                citykeeperCurrentUser
                    .public_user_id;

        return `
            <div
                class="
                    citykeeper-podium-slot
                    rank-${rank}
                    occupied
                    ${current ? "current" : ""}
                "
            >
                <span class="podium-rank">
                    0${rank}
                </span>

                <div class="podium-medallion">
                    <span>
                        ${escapeHTML(
                            medallion
                        )}
                    </span>
                </div>

                <strong>
                    ${escapeHTML(
                        publicId
                    )}
                </strong>

                <small>
                    ${Number(
                        entry.verified || 0
                    )} VERIFIED ${
                        Number(
                            entry.verified || 0
                        ) === 1
                            ? "FIX"
                            : "FIXES"
                    }
                </small>

                <i>
                    ${Number(
                        entry.evidence || 0
                    )} evidence record${
                        Number(
                            entry.evidence || 0
                        ) === 1
                            ? ""
                            : "s"
                    }
                </i>
            </div>
        `;
    };

    if (!entries.length) {
        podium.innerHTML = `
            ${emptySlot(
                2,
                "SECOND MARK"
            )}

            <div
                class="citykeeper-podium-slot empty rank-1"
            >
                <span class="podium-rank">
                    01
                </span>

                <div class="podium-medallion">
                    <span>CF</span>
                </div>

                <strong>
                    FIRST VERIFIED CITYKEEPER
                </strong>

                <small>
                    NO VERIFIED COMMUNITY FIX YET
                </small>

                <i>
                    the first mark appears after
                    citizen verification
                </i>
            </div>

            ${emptySlot(
                3,
                "THIRD MARK"
            )}
        `;

        leaderboard.innerHTML = `
            <div class="citykeeper-leaderboard-empty">
                <span>HALL / 000</span>
            </div>
        `;

        return;
    }

    const first =
        entries[0] || null;

    const second =
        entries[1] || null;

    const third =
        entries[2] || null;

    podium.innerHTML = `
        ${podiumSlot(
            second,
            2
        )}

        ${podiumSlot(
            first,
            1
        )}

        ${podiumSlot(
            third,
            3
        )}
    `;

    leaderboard.innerHTML =
        entries
            .map(
                (
                    entry,
                    index
                ) => {
                    const publicId =
                        String(
                            entry.public_user_id ||
                            "CITYKEEPER"
                        );

                    const current =
                        citykeeperCurrentUser &&
                        publicId ===
                            citykeeperCurrentUser
                                .public_user_id;

                    return `
                        <div
                            class="
                                citykeeper-leaderboard-row
                                ${current ? "current" : ""}
                            "
                        >
                            <span>
                                ${String(
                                    index + 1
                                ).padStart(
                                    2,
                                    "0"
                                )}
                            </span>

                            <strong>
                                ${escapeHTML(
                                    publicId
                                )}
                            </strong>

                            <i>
                                ${Number(
                                    entry.joined || 0
                                )} joined
                            </i>

                            <b>
                                ${Number(
                                    entry.verified || 0
                                )}
                                VERIFIED IMPACT
                            </b>
                        </div>
                    `;
                }
            )
            .join("");
}

function citykeeperMissionDetailMarkup(complaint, state) {
    const id = Number(complaint.complaint_id);
    const key = String(id);

    const joined = Boolean(state.joined[key]);


    // =====================================================
    // REAL CITYKEEPER EVIDENCE FROM BACKEND
    // =====================================================

    const evidenceList =
        backendEvidenceCache.get(id) || [];

    const backendContribution = latestCitykeeperEvidenceForComplaint(id);

    const contribution = backendContribution
        ? {
            image: backendContribution.file_url
                ? (
                    backendContribution.file_url.startsWith("http")
                        ? backendContribution.file_url
                        : `${API_BASE_URL}${backendContribution.file_url}`
                )
                : "",

            note:
                backendContribution.description || "",

            submittedAt:
                backendContribution.uploaded_at,

            hash:
                backendContribution.file_hash,

            evidenceId:
                backendContribution.evidence_id
        }
        : null;


    // =====================================================
    // REAL CITYKEEPER VERIFICATION FROM BACKEND
    // =====================================================

    const verification =
        citykeeperVerificationCache.get(id) || null;

    const verifiedContribution = Boolean(
        contribution &&
        verification &&
        Number(verification.evidence_id) === Number(contribution.evidenceId) &&
        String(verification.decision).toLowerCase() === "verified"
    );

    const rejectedContribution = Boolean(
        contribution &&
        verification &&
        Number(verification.evidence_id) === Number(contribution.evidenceId) &&
        String(verification.decision).toLowerCase() === "rejected"
    );


    // =====================================================
    // ORIGINAL CITIZEN / BEFORE EVIDENCE
    // =====================================================

    const image =
        communityEvidenceImage(complaint);


    // =====================================================
    // MISSION INFORMATION
    // =====================================================

    const resources =
        communityMissionResources(complaint);


    // =====================================================
    // ACTION BUTTON
    // =====================================================

    let actionLabel =
        citykeeperCurrentUser
            ? "BECOME A CITYKEEPER"
            : "SIGN IN TO JOIN";

    if (verifiedContribution) {
        actionLabel =
            "IMPACT VERIFIED ✓";
    }
    else if (rejectedContribution) {
        actionLabel =
            joined
                ? "NEW PROOF NEEDED"
                : (
                    citykeeperCurrentUser
                        ? "BECOME A CITYKEEPER"
                        : "SIGN IN TO JOIN"
                );
    }
    else if (contribution) {
        actionLabel =
            "EVIDENCE ON RECORD";
    }
    else if (joined) {
        actionLabel =
            "YOU'RE IN · MISSION ACTIVE";
    }


    // =====================================================
    // CITYKEEPER-SPECIFIC STATUS
    // =====================================================

    let missionStatus =
        "OPEN TO CITYKEEPERS";

    if (verifiedContribution) {
        missionStatus =
            "VERIFIED IMPACT";
    }
    else if (rejectedContribution) {
        missionStatus =
            "EVIDENCE NOT VERIFIED";
    }
    else if (contribution) {
        missionStatus =
            "EVIDENCE · AWAITING VERIFICATION";
    }
    else if (joined) {
        missionStatus =
            "MISSION ACTIVE";
    }


    return `
        <div class="citykeeper-detail-topline">

            <div>
                <small>
                    COMMUNITY ACTION /
                    ${escapeHTML(formatComplaintId(id))}
                </small>

                <span>
                    ${escapeHTML(missionStatus)}
                </span>
            </div>

            <button
                type="button"
                data-close-citykeeper-detail
                aria-label="Close community mission"
            >
                ×
            </button>

        </div>


        <div class="citykeeper-detail-hero">

            <div
                class="citykeeper-detail-media ${
                    image ? "has-image" : ""
                }"
            >

                ${
                    image
                        ? `
                            <img
                                src="${escapeHTML(image)}"
                                alt="Citizen evidence for this complaint"
                            >
                        `
                        : communityFallbackVisualMarkup(
                            complaint
                        )
                }

                <span class="detail-before-label">
                    BEFORE / ORIGINAL FILE
                </span>

                <span
                    class="detail-scan-line"
                    aria-hidden="true"
                ></span>

            </div>


            <div class="citykeeper-detail-copy">

                <small>
                    ${escapeHTML(
                        communityMissionType(
                            complaint
                        )
                    )}
                </small>

                <h3>
                    ${escapeHTML(
                        getCategoryName(
                            complaint
                        )
                    )}
                </h3>

                <p class="citykeeper-detail-location">
                    ${escapeHTML(
                        publicLocation(
                            complaint
                        )
                    )}
                </p>

                <p class="citykeeper-detail-description">
                    ${escapeHTML(
                        complaint.description ||
                        "No public description recorded."
                    )}
                </p>


                <div class="citykeeper-detail-facts">

                    <div>
                        <small>OPEN</small>

                        <strong>
                            ${escapeHTML(
                                formatDuration(
                                    complaintAgeMs(
                                        complaint
                                    )
                                )
                            )}
                        </strong>
                    </div>


                    <div>
                        <small>CITY</small>

                        <strong>
                            ${escapeHTML(
                                getCityName(
                                    complaint
                                )
                            )}
                        </strong>
                    </div>


                    <div>
                        <small>RECORD</small>

                        <strong>
                            ${escapeHTML(
                                formatComplaintId(
                                    id
                                )
                            )}
                        </strong>
                    </div>

                </div>


                <div class="citykeeper-resource-row">

                    <small>
                        WHAT THIS MISSION MAY NEED
                    </small>

                    <div>
                        ${
                            resources
                                .map(
                                    item =>
                                        `<span>${
                                            escapeHTML(
                                                item
                                            )
                                        }</span>`
                                )
                                .join("")
                        }
                    </div>

                </div>

            </div>

        </div>


        <div class="citykeeper-boundary-note">

            <span>
                SAFE BOUNDARY
            </span>

            <p>
                Citykeepers can support cleanup and
                public-space care. Electrical work,
                road repair, water systems, drainage,
                and safety incidents stay with trained
                authorities.
            </p>

        </div>


        <div class="citykeeper-record-route">

            <span class="done">

                <i>01</i>

                <b>REPORT</b>

                <small>
                    original file
                </small>

            </span>


            <span
                class="${
                    joined
                        ? "done"
                        : "current"
                }"
            >

                <i>02</i>

                <b>PEOPLE JOIN</b>

                <small>
                    Citykeepers
                </small>

            </span>


            <span
                class="${
                    contribution
                        ? "done"
                        : joined
                            ? "current"
                            : ""
                }"
            >

                <i>03</i>

                <b>ACTION</b>

                <small>
                    real-world help
                </small>

            </span>


            <span
                class="${
                    contribution
                        ? "done"
                        : ""
                }"
            >

                <i>04</i>

                <b>EVIDENCE</b>

                <small>
                    after proof
                </small>

            </span>


            <span
                class="${
                    verifiedContribution
                        ? "done"
                        : contribution
                            ? "current"
                            : ""
                }"
            >

                <i>05</i>

                <b>VERIFY</b>

                <small>
                    citizens decide
                </small>

            </span>

        </div>


        <div class="citykeeper-detail-actions">

            <button
                type="button"
                class="citykeeper-join-button ${
                    joined
                        ? "joined"
                        : ""
                }"
                data-citykeeper-join="${id}"
                ${
                    verifiedContribution ||
                    joined ||
                    (
                        contribution &&
                        !rejectedContribution
                    )
                        ? "disabled"
                        : ""
                }
            >

                ${escapeHTML(
                    actionLabel
                )}

                <span>
                    ${
                        joined
                            ? "✓"
                            : "→"
                    }
                </span>

            </button>


            <button
                type="button"
                class="citykeeper-open-original"
                data-citykeeper-original="${id}"
            >

                OPEN ORIGINAL CITYFILE

                <span>
                    ↗
                </span>

            </button>

        </div>


        ${
            (
                joined ||
                contribution
            )
                ? `

                    <div
                        class="citykeeper-evidence-desk ${
                            contribution
                                ? "has-contribution"
                                : ""
                        }"
                    >

                        <div class="citykeeper-evidence-heading">

                            <div>

                                <small>
                                    AFTER / COMMUNITY PROOF
                                </small>

                                <strong>
                                    ${
                                        verifiedContribution
                                            ? "COMMUNITY IMPACT VERIFIED"
                                            : rejectedContribution
                                                ? "EVIDENCE WAS NOT VERIFIED"
                                                : contribution
                                                    ? "ACTION EVIDENCE IS ON YOUR TRAIL"
                                                    : "SHOW WHAT CHANGED."
                                    }
                                </strong>

                            </div>


                            <span>
                                ${
                                    verifiedContribution
                                        ? "CITIZEN VERIFIED"
                                        : rejectedContribution
                                            ? "NOT VERIFIED"
                                            : contribution
                                                ? "AWAITING VERIFICATION"
                                                : "EVIDENCE REQUIRED"
                                }
                            </span>

                        </div>


                        ${
                            contribution
                                ? `

                                    <div class="citykeeper-submitted-proof">

                                        ${
                                            contribution.image
                                                ? `
                                                    <img
                                                        src="${escapeHTML(
                                                            contribution.image
                                                        )}"
                                                        alt="Submitted Citykeeper action evidence"
                                                    >
                                                `
                                                : ""
                                        }


                                        <div>

                                            <small>
                                                SUBMITTED ${
                                                    escapeHTML(
                                                        formatDate(
                                                            contribution.submittedAt
                                                        )
                                                    )
                                                }
                                            </small>


                                            <strong>
                                                ${
                                                    escapeHTML(
                                                        contribution.note ||
                                                        "Community action completed."
                                                    )
                                                }
                                            </strong>


                                            <span>
                                                HASH / ${
                                                    escapeHTML(
                                                        contribution.hash ||
                                                        "NO-HASH"
                                                    )
                                                }
                                            </span>

                                        </div>

                                    </div>

                                `
                                : `

                                    <form
                                        id="citykeeperEvidenceForm"
                                        class="citykeeper-evidence-form"
                                        data-citykeeper-evidence-form="${id}"
                                    >

                                        <label
                                            class="citykeeper-proof-drop"
                                            for="citykeeperEvidenceImage"
                                        >

                                            <input
                                                id="citykeeperEvidenceImage"
                                                type="file"
                                                accept="image/*"
                                                capture="environment"
                                                required
                                            >

                                            <span class="proof-drop-icon">
                                                +
                                            </span>

                                            <strong>
                                                ADD AFTER PHOTO
                                            </strong>

                                            <small>
                                                Proof should show the same
                                                public problem after community
                                                action.
                                            </small>

                                        </label>


                                        <div
                                            id="citykeeperEvidencePreview"
                                            class="citykeeper-evidence-preview"
                                            hidden
                                        >

                                            <img
                                                id="citykeeperEvidencePreviewImage"
                                                alt="Citykeeper evidence preview"
                                            >

                                            <span>
                                                AFTER / PREVIEW
                                            </span>

                                        </div>


                                        <label class="citykeeper-note-field">

                                            <span>
                                                WHAT DID YOU DO?
                                            </span>

                                            <textarea
                                                id="citykeeperActionNote"
                                                rows="4"
                                                placeholder="Example: Cleared ordinary litter around the park entrance and prepared it for collection."
                                                required
                                            ></textarea>

                                        </label>


                                        <button
                                            type="submit"
                                            class="citykeeper-submit-evidence"
                                        >

                                            PLACE ACTION ON YOUR TRAIL

                                            <span>
                                                →
                                            </span>

                                        </button>


                                        <p class="citykeeper-form-note">
                                            Your action photo, note and
                                            evidence hash will be attached
                                            to this civic record.
                                        </p>

                                    </form>

                                `
                        }

                    </div>

                `
                : ""
        }
    `;
}

function citykeeperEvidenceFormMarkup(
    complaintId,
    {
        resubmission = false
    } = {}
) {
    const id =
        Number(complaintId);

    return `
        <div
            class="citykeeper-evidence-heading"
            data-citykeeper-resubmit-heading="${id}"
        >
            <div>
                <small>
                    ${
                        resubmission
                            ? "RETRY / COMMUNITY PROOF"
                            : "AFTER / COMMUNITY PROOF"
                    }
                </small>

                <strong>
                    ${
                        resubmission
                            ? "THE LAST PROOF WAS NOT VERIFIED. SHOW WHAT CHANGED NOW."
                            : "SHOW WHAT CHANGED."
                    }
                </strong>
            </div>

            <span>
                EVIDENCE REQUIRED
            </span>
        </div>

        <form
            id="citykeeperEvidenceForm"
            class="citykeeper-evidence-form"
            data-citykeeper-evidence-form="${id}"
        >
            <label
                class="citykeeper-proof-drop"
                for="citykeeperEvidenceImage"
            >
                <input
                    id="citykeeperEvidenceImage"
                    type="file"
                    accept="image/*"
                    capture="environment"
                    required
                >

                <span class="proof-drop-icon">
                    +
                </span>

                <strong>
                    ADD AFTER PHOTO
                </strong>

                <small>
                    Proof should show the same
                    public problem after community
                    action.
                </small>
            </label>

            <div
                id="citykeeperEvidencePreview"
                class="citykeeper-evidence-preview"
                hidden
            >
                <img
                    id="citykeeperEvidencePreviewImage"
                    alt="Citykeeper evidence preview"
                >

                <span>
                    AFTER / PREVIEW
                </span>
            </div>

            <label class="citykeeper-note-field">
                <span>
                    WHAT DID YOU DO?
                </span>

                <textarea
                    id="citykeeperActionNote"
                    rows="4"
                    placeholder="Example: Cleared ordinary litter around the park entrance and prepared it for collection."
                    required
                ></textarea>
            </label>

            <button
                type="submit"
                class="citykeeper-submit-evidence"
            >
                PLACE ACTION ON YOUR TRAIL

                <span>
                    →
                </span>
            </button>

            <p class="citykeeper-form-note">
                Your action photo, note and
                evidence hash will be attached
                to this civic record.
            </p>
        </form>
    `;
}


function decorateCitykeeperMissionVerification(
    complaint
) {
    const detail =
        document.getElementById(
            "citykeeperMissionDetail"
        );

    if (
        !detail ||
        !complaint
    ) {
        return;
    }

    const id =
        Number(
            complaint.complaint_id
        );

    const evidenceList =
        backendEvidenceCache.get(
            id
        ) || [];

    const evidence = latestCitykeeperEvidenceForComplaint(id);

    if (!evidence) {
        return;
    }

    const verification =
        citykeeperVerificationCache.get(
            id
        ) || null;

    const decision =
        String(
            verification?.decision || ""
        ).toLowerCase();

    const submittedProof =
        detail.querySelector(
            ".citykeeper-submitted-proof"
        );

    const evidenceDesk =
        detail.querySelector(
            ".citykeeper-evidence-desk"
        );

    if (
        !submittedProof ||
        !evidenceDesk
    ) {
        return;
    }

    detail
        .querySelectorAll(
            "[data-citykeeper-verification-controls], [data-citykeeper-resubmit]"
        )
        .forEach(
            element =>
                element.remove()
        );

    if (
        decision === "verified"
    ) {
        return;
    }

    if (
        decision === "rejected"
    ) {
        const state =
            getCitykeeperState();

        const joined =
            Boolean(
                state.joined[
                    String(id)
                ]
            );

        if (
            !joined ||
            !citykeeperCurrentUser
        ) {
            return;
        }

        const resubmit =
            document.createElement(
                "div"
            );

        resubmit.setAttribute(
            "data-citykeeper-resubmit",
            String(id)
        );

        resubmit.innerHTML =
            citykeeperEvidenceFormMarkup(
                id,
                {
                    resubmission: true
                }
            );

        submittedProof.insertAdjacentElement(
            "afterend",
            resubmit
        );

        return;
    }

    const controls =
        document.createElement(
            "div"
        );

    controls.className =
        "citykeeper-detail-actions";

    controls.setAttribute(
        "data-citykeeper-verification-controls",
        String(id)
    );

    if (!citykeeperCurrentUser) {
        controls.innerHTML = `
            <button
                type="button"
                class="citykeeper-join-button"
                data-citykeeper-auth
            >
                SIGN IN TO VERIFY
                <span>→</span>
            </button>
        `;
    }
    else if (
        Number(
            evidence.uploaded_by_user
        ) ===
        Number(
            citykeeperCurrentUser.user_id
        )
    ) {
        controls.innerHTML = `
            <button
                type="button"
                class="citykeeper-join-button joined"
                disabled
            >
                ANOTHER CITIZEN MUST VERIFY
                <span>○</span>
            </button>
        `;
    }
    else {
        controls.innerHTML = `
            <button
                type="button"
                class="citykeeper-join-button"
                data-citykeeper-verify="verified"
                data-citykeeper-verify-complaint="${id}"
            >
                YES · VERIFY IMPACT
                <span>✓</span>
            </button>

            <button
                type="button"
                class="citykeeper-open-original"
                data-citykeeper-verify="rejected"
                data-citykeeper-verify-complaint="${id}"
            >
                NO · PROOF DOES NOT VERIFY
                <span>↩</span>
            </button>
        `;
    }

    submittedProof.insertAdjacentElement(
        "afterend",
        controls
    );
}

function openCitykeeperMission(complaintId) {
    const id =
        Number(
            complaintId
        );

    const complaint =
        allComplaints.find(
            item =>
                Number(
                    item.complaint_id
                ) === id
        );

    const detail =
        document.getElementById(
            "citykeeperMissionDetail"
        );

    if (
        !complaint ||
        !detail ||
        !isCommunityEligible(
            complaint
        )
    ) {
        showToast(
            "This record is not available as a community mission."
        );

        return;
    }

    activeCitykeeperMissionId =
        id;

    detail.hidden = false;

    detail.innerHTML =
        citykeeperMissionDetailMarkup(
            complaint,
            getCitykeeperState()
        );

    decorateCitykeeperMissionVerification(
        complaint
    );

    detail.scrollIntoView({
        behavior: "smooth",
        block: "start"
    });
}

function closeCitykeeperMission() {
    const detail = document.getElementById("citykeeperMissionDetail");
    if (!detail) return;
    detail.hidden = true;
    detail.innerHTML = "";
    activeCitykeeperMissionId = null;
}

async function toggleCitykeeperJoin(complaintId) {
    const id =
        Number(
            complaintId
        );

    if (!citykeeperCurrentUser) {
        await openCitykeeperAuth();
        return;
    }

    try {
        const participation =
            await fetchJSON(
                `/citykeepers/${id}/join`,
                {
                    method: "POST"
                }
            );

        await Promise.all([
            loadCitykeeperParticipations(),
            loadCitykeeperProfile(),
            loadCitykeeperMissionStats(),
            loadCitykeeperLeaderboard(),
            loadMyComplaints()
        ]);

        if (
            participation.already_joined
        ) {
            showToast(
                "You're already part of this Citykeeper mission."
            );
        }
        else {
            showToast(
                "You're in. Your participation is now on record."
            );
        }

        renderCitykeepers();

        if (
            activeCitykeeperMissionId
        ) {
            openCitykeeperMission(
                activeCitykeeperMissionId
            );
        }
    }
    catch (error) {
        console.error(
            "Could not join Citykeeper mission:",
            error
        );

        if (
            error?.status === 401
        ) {
            await openCitykeeperAuth();
            return;
        }

        showToast(
            error?.message ||
            "Could not join this mission. Please try again."
        );
    }
}

async function hashCitykeeperEvidence(dataUrl) {
    try {
        if (crypto?.subtle && window.TextEncoder) {
            const bytes = new TextEncoder().encode(dataUrl);
            const digest = await crypto.subtle.digest("SHA-256", bytes);
            return Array.from(new Uint8Array(digest))
                .map(byte => byte.toString(16).padStart(2, "0"))
                .join("")
                .slice(0, 24)
                .toUpperCase();
        }
    }
    catch (error) {
        console.warn("Could not hash Citykeeper evidence:", error);
    }

    let hash = 0;
    for (let index = 0; index < dataUrl.length; index += 97) {
        hash = ((hash << 5) - hash + dataUrl.charCodeAt(index)) | 0;
    }
    return `LOCAL-${Math.abs(hash).toString(16).toUpperCase().padStart(8, "0")}`;
}


async function submitCitykeeperEvidence(form) {
    const id =
        Number(
            form.dataset
                .citykeeperEvidenceForm ||
            ""
        );

    const complaint =
        allComplaints.find(
            item =>
                Number(
                    item.complaint_id
                ) === id
        );

    const fileInput =
        form.querySelector(
            "#citykeeperEvidenceImage"
        );

    const noteInput =
        form.querySelector(
            "#citykeeperActionNote"
        );

    const file =
        fileInput?.files?.[0];

    const note =
        noteInput?.value.trim();

    if (!citykeeperCurrentUser) {
        await openCitykeeperAuth();
        return;
    }

    if (
        !complaint ||
        !file ||
        !note
    ) {
        showToast(
            "Add an after photo and a short action note first."
        );

        return;
    }

    try {
        const formData =
            new FormData();

        formData.append(
            "file",
            file
        );

        formData.append(
            "description",
            note
        );

        await fetchJSON(
            `/citykeepers/${id}/evidence/upload`,
            {
                method: "POST",
                body: formData
            }
        );

        await Promise.all([
            loadBackendEvidence(
                id
            ),
            loadCitykeeperVerification(
                id
            ),
            loadCitykeeperParticipations(),
            loadCitykeeperProfile(),
            loadCitykeeperMissionStats(),
            loadCitykeeperLeaderboard()
        ]);

        showToast(
            "Community evidence added. Another citizen must verify it."
        );

        renderCitykeepers();

        openCitykeeperMission(
            id
        );
    }
    catch (error) {
        console.error(
            "Citykeeper evidence upload error:",
            error
        );

        if (
            error?.status === 401
        ) {
            await openCitykeeperAuth();
            return;
        }

        showToast(
            error?.message ||
            "Could not upload the community evidence."
        );
    }
}


async function verifyCitykeeperEvidence(
    complaintId,
    decision
) {
    const id =
        Number(
            complaintId
        );

    if (!citykeeperCurrentUser) {
        await openCitykeeperAuth();
        return;
    }

    const normalized =
        String(
            decision || ""
        ).toLowerCase();

    if (
        ![
            "verified",
            "rejected"
        ].includes(
            normalized
        )
    ) {
        return;
    }

    try {
        const result =
            await fetchJSON(
                `/citykeepers/${id}/verify?decision=${encodeURIComponent(
                    normalized
                )}`,
                {
                    method: "POST"
                }
            );

        await Promise.all([
            loadBackendEvidence(
                id
            ),
            loadCitykeeperVerification(
                id
            ),
            loadCitykeeperProfile(),
            loadCitykeeperMissionStats(),
            loadCitykeeperLeaderboard()
        ]);

        if (
            result?.already_decided
        ) {
            showToast(
                "This evidence already has a citizen decision on record."
            );
        }
        else if (
            normalized ===
            "verified"
        ) {
            showToast(
                "Community impact verified. The decision is now on record."
            );
        }
        else {
            showToast(
                "Proof was not verified. The mission can receive new evidence."
            );
        }

        renderCitykeepers();

        openCitykeeperMission(
            id
        );
    }
    catch (error) {
        console.error(
            "Citykeeper verification error:",
            error
        );

        if (
            error?.status === 401
        ) {
            await openCitykeeperAuth();
            return;
        }

        showToast(
            error?.message ||
            "Could not record that verification."
        );
    }
}

function renderCitykeepers() {
    if (
        !document.getElementById(
            "citykeepersView"
        )
    ) {
        return;
    }

    const yourMarkSection =
        document.getElementById(
            "citykeeperYourMark"
        );

    if (yourMarkSection) {
        yourMarkSection.classList.toggle(
            "citykeeper-signed-out",
            !citykeeperCurrentUser
        );

        yourMarkSection.classList.toggle(
            "citykeeper-signed-in",
            Boolean(citykeeperCurrentUser)
        );
    }

    renderCitykeeperAuthButton();

    const state =
        getCitykeeperState();

    renderCitykeeperMissions(
        state
    );


renderCitykeeperVerifiedImpact();
renderCitykeeperProfile(state);
renderCitykeeperHall(state);

    if (
        activeCitykeeperMissionId
    ) {
        const complaint =
            allComplaints.find(
                item =>
                    Number(
                        item.complaint_id
                    ) ===
                    Number(
                        activeCitykeeperMissionId
                    )
            );

        const detail =
            document.getElementById(
                "citykeeperMissionDetail"
            );

        if (
            complaint &&
            detail &&
            !detail.hidden &&
            isCommunityEligible(
                complaint
            )
        ) {
            detail.innerHTML =
                citykeeperMissionDetailMarkup(
                    complaint,
                    state
                );

            decorateCitykeeperMissionVerification(
                complaint
            );
        }
        else if (detail) {
            closeCitykeeperMission();
        }
    }
}

function initializeCitykeepers() {
    const view =
        document.getElementById(
            "citykeepersView"
        );

    if (!view) {
        return;
    }

    view.addEventListener(
        "click",
        async event => {
            const authButton =
                event.target.closest(
                    "[data-citykeeper-auth]"
                );

            if (authButton) {
                await openCitykeeperAuth();
                return;
            }

            const jump =
                event.target.closest(
                    "[data-citykeepers-jump]"
                );

            if (jump) {
                const target =
                    jump.dataset
                        .citykeepersJump ===
                    "mark"
                        ? document.getElementById(
                            "citykeeperYourMark"
                        )
                        : document.getElementById(
                            "citykeeperMissions"
                        );

                target?.scrollIntoView({
                    behavior: "smooth",
                    block: "start"
                });

                return;
            }

            const openButton =
                event.target.closest(
                    "[data-open-citykeeper-mission]"
                );

            if (openButton) {
                openCitykeeperMission(
                    openButton.dataset
                        .openCitykeeperMission
                );

                return;
            }

            const closeButton =
                event.target.closest(
                    "[data-close-citykeeper-detail]"
                );

            if (closeButton) {
                closeCitykeeperMission();
                return;
            }

            const joinButton =
                event.target.closest(
                    "[data-citykeeper-join]"
                );

            if (joinButton) {
                await toggleCitykeeperJoin(
                    joinButton.dataset
                        .citykeeperJoin
                );

                return;
            }

            const verifyButton =
                event.target.closest(
                    "[data-citykeeper-verify]"
                );

            if (verifyButton) {
                await verifyCitykeeperEvidence(
                    verifyButton.dataset
                        .citykeeperVerifyComplaint,
                    verifyButton.dataset
                        .citykeeperVerify
                );

                return;
            }

            const originalButton =
                event.target.closest(
                    "[data-citykeeper-original]"
                );

            if (originalButton) {
                openCase(
                    Number(
                        originalButton.dataset
                            .citykeeperOriginal
                    )
                );

                return;
            }

            const hallTab =
                event.target.closest(
                    "[data-hall-period]"
                );

            if (hallTab) {
                citykeeperHallPeriod =
                    hallTab.dataset
                        .hallPeriod ===
                    "all"
                        ? "all"
                        : "month";

                view
                    .querySelectorAll(
                        "[data-hall-period]"
                    )
                    .forEach(
                        button => {
                            const active =
                                button.dataset
                                    .hallPeriod ===
                                citykeeperHallPeriod;

                            button.classList.toggle(
                                "active",
                                active
                            );

                            button.setAttribute(
                                "aria-pressed",
                                active
                                    ? "true"
                                    : "false"
                            );
                        }
                    );

                await loadCitykeeperLeaderboard();
                renderCitykeeperHall();

                return;
            }
        }
    );

    view.addEventListener(
        "keydown",
        async event => {
            const authButton = event.target.closest(
                "[data-citykeeper-auth][role=\"button\"]"
            );

            if (
                authButton &&
                (event.key === "Enter" || event.key === " ")
            ) {
                event.preventDefault();
                await openCitykeeperAuth();
            }
        }
    );


    view.addEventListener(
        "change",
        async event => {
            const input =
                event.target.closest(
                    "#citykeeperEvidenceImage"
                );

            if (
                !input?.files?.[0]
            ) {
                return;
            }

            try {
                const image =
                    await compressAuthorityImage(
                        input.files[0],
                        1200,
                        0.7
                    );

                const form =
                    input.closest(
                        "[data-citykeeper-evidence-form]"
                    );

                const preview =
                    form?.querySelector(
                        "#citykeeperEvidencePreview"
                    ) ||
                    document.getElementById(
                        "citykeeperEvidencePreview"
                    );

                const previewImage =
                    form?.querySelector(
                        "#citykeeperEvidencePreviewImage"
                    ) ||
                    document.getElementById(
                        "citykeeperEvidencePreviewImage"
                    );

                if (
                    preview &&
                    previewImage
                ) {
                    previewImage.src =
                        image;

                    preview.hidden =
                        false;
                }
            }
            catch (error) {
                console.error(
                    "Citykeeper preview error:",
                    error
                );

                showToast(
                    "Could not preview that image."
                );
            }
        }
    );

    view.addEventListener(
        "submit",
        event => {
            const form =
                event.target.closest(
                    "[data-citykeeper-evidence-form]"
                );

            if (!form) {
                return;
            }

            event.preventDefault();

            submitCitykeeperEvidence(
                form
            );
        }
    );
}


/* ============================================================
   LOAD DATA + HOME
   ============================================================ */
async function loadComplaints({
    silent = false
} = {}) {
    try {
        const [complaints, blockchainPayload] = await Promise.all([
            fetchJSON("/complaints"),
            fetchJSON("/blockchain")
        ]);

        const complaintList = Array.isArray(complaints)
            ? complaints
            : [];

        // Support both the older array response and the newer integrity object.
        const blocks = Array.isArray(blockchainPayload)
            ? blockchainPayload
            : (Array.isArray(blockchainPayload?.blocks)
                ? blockchainPayload.blocks
                : []);

        blockchainHashesByComplaintId = new Map();

        blocks.forEach((block) => {
            if (
                block?.complaint_id != null &&
                block?.hash
            ) {
                blockchainHashesByComplaintId.set(
                    Number(block.complaint_id),
                    block.hash
                );
            }
        });

        // Preserve complaint serialization from the newer backend while also
        // retaining the remote branch's blockchain hash lookup.
        allComplaints = complaintList.map((complaint) => {
            const complaintId = Number(complaint.complaint_id);
            const blockchainHash =
                blockchainHashesByComplaintId.get(complaintId);

            return {
                ...complaint,
                blockchain_tx_hash:
                    blockchainHash ||
                    complaint.blockchain_tx_hash ||
                    complaint.blockchain_hash ||
                    ""
            };
        });

        // Complaint serialization already includes evidence, so reuse it
        // instead of making one extra evidence request per complaint.
        for (const complaint of allComplaints) {
            backendEvidenceCache.set(
                Number(complaint.complaint_id),
                Array.isArray(complaint.evidence)
                    ? complaint.evidence
                    : []
            );
        }

        // Citykeeper verification is only relevant for community-safe files.
        await Promise.all(
            allComplaints
                .filter(isCommunityEligible)
                .map((complaint) =>
                    loadCitykeeperVerification(
                        complaint.complaint_id
                    )
                )
        );

        // Load backend-driven Citykeeper state.
        await Promise.all([
            loadCitykeeperParticipations(),
            loadCitykeeperProfile(),
            loadCitykeeperMissionStats(),
            loadCitykeeperLeaderboard(),
            loadMyComplaints()
        ]);

        updateHomeMetrics();
        updateHomeProblemStatuses();
        renderHomeProblemFiles();
        renderArchive();
        renderMapMarkers();
        renderProfileFiles();
        renderIntegrityEvents();
        renderAuthorityDashboard();
        renderCitykeepers();

        const openOverlay = document.getElementById("caseOverlay");
        if (
            currentCaseComplaintId &&
            openOverlay &&
            !openOverlay.hidden
        ) {
            openCase(currentCaseComplaintId);
        }

        return allComplaints;
    }
    catch (error) {
        console.error("Complaint loading error:", error);

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
            "awaiting verification",
            "disputed",
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


function complaintCoordinates(complaint) {
    const latitude = Number(complaint?.latitude);
    const longitude = Number(complaint?.longitude);

    if (Number.isFinite(latitude) && Number.isFinite(longitude)) {
        return [latitude, longitude];
    }

    return extractCoordinates(complaint);
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
                complaint => (
                    activeMapFilter === "all" ||
                    issueGroup(complaint) === activeMapFilter
                )
            )
            .filter(
                complaint => Boolean(complaintCoordinates(complaint))
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
                : "No unresolved records with stored coordinates match this filter.";
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


function saveMyComplaintId() {
    // Deprecated: YOUR FILES ownership comes from Clerk + complaint.user_id.
    return true;
}


function getReporterPayload() {
    const phoneInput = document.getElementById("phone");
    const phone = phoneInput?.value.trim() || "";

    if (!/^[0-9]{10}$/.test(phone)) {
        if (phoneInput) {
            phoneInput.setCustomValidity(
                "Phone number must contain exactly 10 digits."
            );
            phoneInput.reportValidity();
            phoneInput.focus();
        }

        throw new Error("Phone number must contain exactly 10 digits.");
    }

    if (phoneInput) {
        phoneInput.setCustomValidity("");
    }

    return {
        name: document.getElementById("name")?.value.trim() || "",
        email: document.getElementById("email")?.value.trim() || "",
        phone: phone,
        publicUserId: document.getElementById("userId")?.value.trim() || ""
    };
}
async function createReporterIfNeeded() {
    // Reporter contact is now submitted atomically with the complaint and
    // stored in the backend's private complaint_reporters table.
    return getReporterPayload();
}

function buildComplaintPayload(reporter = {}) {
    const city = document.getElementById("city");
    const category = document.getElementById("category");
    const department = document.getElementById("department");
    const description = document.getElementById("description");
    const priority = document.getElementById("priority");

    return {
        city_id: Number(city?.value),
        category_id: Number(category?.value),
        department_id: Number(department?.value),
        location: locationPayloadFromForm(),
        description: description?.value?.trim() || "",
        priority: priority?.value || "Medium",
        reporter_name: reporter.name || null,
        reporter_email: reporter.email || null,
        reporter_phone: reporter.phone || null,
        reporter_public_user_id: reporter.publicUserId || null
    };
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

    result.hidden = false;

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
        submitButton.disabled = true;

        submitButton.dataset.originalText =
            submitButton.textContent;

        submitButton.textContent =
            "CREATING PUBLIC RECORD…";
    }

    try {
        const evidenceFile =
            document.getElementById("evidence")
                ?.files?.[0] || null;

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

        // 1. Create the complaint first
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

        // 2. Save complaint ID
        if (
            complaint?.complaint_id !==
            undefined
        ) {
            saveMyComplaintId(
                complaint.complaint_id
            );

            // 3. Upload original citizen image. The complaint itself has
            // already been committed, so an image failure is reported as a
            // partial success rather than pretending the record vanished.
            if (evidenceFile) {
                const formData = new FormData();
                formData.append("file", evidenceFile);
                formData.append("evidence_type", "citizen_report");
                formData.append("description", "Original citizen evidence");

                try {
                    await fetchJSON(
                        `/complaints/${complaint.complaint_id}/evidence/upload`,
                        { method: "POST", body: formData }
                    );
                }
                catch (evidenceError) {
                    console.error("Citizen evidence upload error:", evidenceError);
                    showToast(
                        `Record ${formatComplaintId(complaint.complaint_id)} was created, but the evidence photo could not be uploaded.`
                    );
                }
            }
        }

        // 4. Reset UI after everything succeeds
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
            "useLocationButton"
        )
        ?.addEventListener(
            "click",
            getLocation
        );

    document
        .getElementById(
            "clearPinButton"
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
                /^CF-/,
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

function lifecycleTimestamp(complaint, index, step) {
    if (index === 0) return formatDate(complaint.created_at);
    if (step?.state === "waiting") return "RECORD ABSENT";

    const updates = Array.isArray(complaint?.updates) ? complaint.updates : [];
    const attempts = Array.isArray(complaint?.resolution_attempts)
        ? complaint.resolution_attempts
        : [];
    const latestAttempt = attempts.length ? attempts[attempts.length - 1] : null;

    if (index === 1) {
        const update = updates.find(item =>
            ["acknowledged", "in progress", "awaiting verification", "verified", "disputed"]
                .includes(String(item?.status || "").trim().toLowerCase())
        );
        return update?.updated_at ? formatDate(update.updated_at) : "RECORDED";
    }

    if (index === 2) {
        const update = updates.find(item =>
            ["in progress", "awaiting verification", "verified", "disputed"]
                .includes(String(item?.status || "").trim().toLowerCase())
        );
        return update?.updated_at ? formatDate(update.updated_at) : "RECORDED";
    }

    if (index === 3) {
        const proof = latestAttempt?.proof;
        return proof?.capturedAt || proof?.created_at
            ? formatDate(proof.capturedAt || proof.created_at)
            : "RECORDED";
    }

    if (index === 4) {
        const review = latestAttempt?.review;
        return review?.timestamp || review?.created_at
            ? formatDate(review.timestamp || review.created_at)
            : "RECORDED";
    }

    return "RECORDED";
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
                    Use a CITYFILE record such as CF-000123.
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

        upsertComplaintRecord(complaint);

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
                                        lifecycleTimestamp(
                                            complaint,
                                            index,
                                            step
                                        );


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
                                                data-verification-action="verified"
                                            >
                                                YES ✓
                                            </button>

                                            <button
                                                type="button"
                                                data-verification-action="reopened"
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
           CITIZEN VERIFICATION — BACKEND PERSISTED
           ===================================================== */

        result
            .querySelectorAll("[data-verification-action]")
            .forEach(button => {
                button.addEventListener("click", async () => {
                    await reviewAuthorityResolution(
                        complaint.complaint_id,
                        button.dataset.verificationAction
                    );
                });
            });


        /* The fetched record was already merged into the shared cache. */

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

async function loadMyComplaints() {
    if (!citykeeperAuthEnabled || !citykeeperCurrentUser) {
        myComplaints = [];
        return myComplaints;
    }

    try {
        const records = await fetchJSON("/me/complaints");
        myComplaints = Array.isArray(records) ? records : [];
        return myComplaints;
    }
    catch (error) {
        console.warn("Could not load authenticated complaint history:", error);
        myComplaints = [];
        return [];
    }
}

function getMyComplaints() {
    return myComplaints
        .slice()
        .sort((a, b) =>
            (Date.parse(b.created_at || "") || 0) -
            (Date.parse(a.created_at || "") || 0)
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

    if (citykeeperAuthEnabled && !citykeeperCurrentUser) {
        grid.innerHTML = `
            <div class="semantic-empty profile-empty" style="grid-column:1/-1">
                <strong>SIGN IN TO SEE YOUR FILES.</strong>
                <p>Your civic footprint is tied to your authenticated CITYFILE account, not this browser.</p>
                <button type="button" id="profileSignInButton">SIGN IN →</button>
            </div>
        `;

        grid.querySelector("#profileSignInButton")?.addEventListener(
            "click",
            openCitykeeperAuth
        );
        return;
    }

    if (!citykeeperAuthEnabled) {
        grid.innerHTML = `
            <div class="semantic-empty profile-empty" style="grid-column:1/-1">
                <strong>ACCOUNT HISTORY IS NOT CONFIGURED.</strong>
                <p>Configure Clerk to make YOUR FILES account-scoped and persistent across browsers.</p>
            </div>
        `;
        return;
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
                            The authority submitted public
                            resolution evidence. Review the
                            before/after proof before deciding
                            whether the issue is actually fixed.
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
                                class="profile-verify-resolution"
                                data-open-citizen-verification
                            >
                                VERIFY RESOLUTION →
                            </button>

                            <button
                                type="button"
                                class="profile-view-proof"
                                data-open-authority-proof
                            >
                                VIEW AUTHORITY PROOF
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
        .querySelector(
            "[data-open-citizen-verification]"
        )
        ?.addEventListener(
            "click",
            () => {
                openCitizenVerification(
                    complaint.complaint_id
                );
            }
        );

    detail
        .querySelector(
            "[data-open-authority-proof]"
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
}/* ============================================================
   CASE OVERLAY — FULL PUBLIC RECORD
   ============================================================ */

function statusExplanation(complaint) {
    if (isCitizenReopened(complaint)) {
        return (
            "A citizen challenged the latest authority resolution. " +
            "The complaint is back in the authority action queue, and the earlier resolution attempt remains public."
        );
    }

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
                        LOCAL INTEGRITY CHAIN
                    </small>

                    <strong>
                        NOT ANCHORED YET
                    </strong>

                    <p>
                        No local SHA-256 hash-chain anchor
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
                    LOCAL HASH CHAIN
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
    currentCaseComplaintId = Number(complaintId);

    const overlay =
        document.getElementById(
            "caseOverlay"
        );

    const body =
        document.getElementById(
            "caseOverlayBody"
        ) ||
        document.getElementById(
            "caseContent"
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

        upsertComplaintRecord(complaint);

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


                ${
                    authorityProofPublicHTML(
                        complaint
                    )
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
    currentCaseComplaintId = null;

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
        .querySelectorAll(
            "[data-close-case]"
        )
        .forEach(element => {
            element.addEventListener(
                "click",
                closeCaseOverlay
            );
        });

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

    const integrityEvents = Array.isArray(complaint?.integrity_events)
        ? complaint.integrity_events
        : [];

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
                        ? "✓ HASH LINK PRESENT"
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
                LOCAL HASH-CHAIN ANCHOR
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
                            CITYFILE found this record in its
                            file-backed SHA-256 hash chain.
                            This is tamper-evident integrity
                            metadata, not a public blockchain transaction.
                        </p>
                    `

                    : `
                        <strong>
                            The visible chain breaks here.
                        </strong>

                        <p>
                            This record currently has no
                            local hash-chain anchor.
                            CITYFILE does not invent one or
                            pretend the record is anchored.
                        </p>
                    `
            }

        </div>

        ${integrityEvents.length ? `
            <div class="integrity-detail-grid">
                ${integrityEvents.map(event => `
                    <div>
                        <small>LINK ${escapeHTML(String(event.index ?? "—"))} · ${escapeHTML(formatDate(event.timestamp))}</small>
                        <strong>${escapeHTML(String(event?.data?.event || "LEGACY RECORD").replaceAll("_", " ").toUpperCase())}</strong>
                        <code>${escapeHTML(shortenedHash(event.hash || ""))}</code>
                    </div>
                `).join("")}
            </div>
        ` : ""}

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
       local integrity chain rather than creating
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

                        openHomeCategoryRecords(
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
            "citykeepers",
            "authority",
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
   LEGACY PROFILE STORAGE CLEANUP
   ============================================================ */

function cleanupStoredComplaintIds() {
    // Legacy browser ownership is intentionally ignored. Profile data now
    // comes from /me/complaints and the authenticated backend identity.
    try {
        localStorage.removeItem("cityfile_my_complaints");
    }
    catch (error) {
        console.warn("Could not clear legacy complaint ownership cache:", error);
    }
}

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

    if (
        viewName ===
        "authority"
    ) {
        renderAuthorityDashboard();
    }

    if (
        viewName ===
        "citykeepers"
    ) {
        renderCitykeepers();
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

//window.openMapFor =
//   openMapFor; 

window.trackComplaint =
    trackComplaint;

window.loadComplaints =
    loadComplaints;

window.refreshEverything =
    refreshEverything;

window.openAuthorityAction =
    openAuthorityAction;

window.closeAuthorityAction =
    closeAuthorityAction;

window.updateAuthorityStatus =
    updateAuthorityStatus;

window.updateAuthorityDeadline =
    updateAuthorityDeadline;

window.reviewAuthorityResolution =
    reviewAuthorityResolution;

window.openCitizenVerification =
    openCitizenVerification;


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

    initializeCityDepartmentLink();

    initializeEvidencePreview();

    initializeTracking();

    initializeCaseOverlay();

    initializeHomeMarkers();

    initializeHomeActions();

    initializeReportHelpers();

    initializeButtonFeedback();

    initializeExternalRefreshButtons();

    initializeIntegrityInteractions();

    initializeCitykeepers();

    initializeAuthorityDashboard();

    initializeKeyboardSupport();

    initializeHashNavigation();

    handleOnlineState();

    // Clerk is loaded before Citykeepers data so protected
    // participation/profile requests can attach a valid token.
    await initializeClerkAuth();


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
        "citykeepersView",
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
/* =====================================================
   HOME PAGE PROBLEM CATEGORY STATUS
   ===================================================== */

function getHomeCategoryStatus(group) {

    const records = allComplaints.filter(
        complaint => issueGroup(complaint) === group
    );

    // No complaint has been reported
    if (records.length === 0) {
        return "NO REPORTS";
    }

    // All complaints are completely verified
    if (records.every(complaint => isVerified(complaint))) {
        return "RESOLVED";
    }

    // Authority has marked at least one complaint as fixed
    if (
        records.some(
            complaint => isAuthorityResolved(complaint)
        )
    ) {
        return "VERIFY FIX";
    }

    // Authority is working on at least one complaint
    if (
        records.some(
            complaint => isInProgress(complaint)
        )
    ) {
        return "IN PROGRESS";
    }

    // Complaint exists but work has not started
    return "REPORTED";
}


/* =====================================================
   UPDATE THE 4 HOME PAGE PROBLEM CARDS
   ===================================================== */

function updateHomeProblemStatuses() {

    const statusElements = {
        road: document.getElementById("homeRoadStatus"),
        streetlight: document.getElementById("homeStreetlightStatus"),
        water: document.getElementById("homeWaterStatus"),
        sanitation: document.getElementById("homeSanitationStatus")
    };

    Object.entries(statusElements).forEach(
        ([group, element]) => {

            if (!element) return;

            element.textContent =
                getHomeCategoryStatus(group);
        }
    );
}


/* =====================================================
   OPEN POPUP FOR A PROBLEM CATEGORY
   ===================================================== */

function openHomeCategoryRecords(group) {

    const overlay =
        document.getElementById("caseOverlay");

    const body =
        document.getElementById("caseContent");

    if (!overlay || !body) return;


    const records =
        allComplaints
            .filter(
                complaint =>
                    issueGroup(complaint) === group
            )
            .sort(
                (a, b) =>
                    (Date.parse(b.created_at || "") || 0) -
                    (Date.parse(a.created_at || "") || 0)
            );


    const categoryNames = {
        road: "POTHOLE",
        streetlight: "STREETLIGHT",
        water: "PIPE LEAK",
        sanitation: "WASTE"
    };


    const categoryName =
        categoryNames[group] || "PROBLEM";


    /* ---------------------------------------------
       NO RECORDS
       --------------------------------------------- */

    if (records.length === 0) {

        body.innerHTML = `

            <div class="case-record">

                <div class="case-record-intro">

                    <small>
                        CITYFILE / PUBLIC RECORDS
                    </small>

                    <h2>
                        ${categoryName}
                    </h2>

                    <p>
                        No complaints have been reported
                        for this problem yet.
                    </p>

                </div>

            </div>

        `;

    }

    /* ---------------------------------------------
       RECORDS EXIST
       --------------------------------------------- */

    else {

        body.innerHTML = `

            <div class="case-record">

                <section class="case-record-intro">

                    <small>
                        CITYFILE / PUBLIC RECORDS
                    </small>

                    <h2>
                        ${categoryName}
                    </h2>

                    <p>
                        ${records.length}
                        public record${records.length === 1 ? "" : "s"}
                        found.
                    </p>

                </section>


                <section class="case-record-section">

                    <div class="case-section-heading">

                        <small>
                            REPORTED PROBLEMS
                        </small>

                        <h3>
                            ${categoryName} records
                        </h3>

                    </div>


                    <div class="home-category-record-list">

                        ${records.map(complaint => `

                            <article
                                class="home-category-record"
                            >

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
                                            publicLocation(
                                                complaint
                                            )
                                        )}
                                    </h4>

                                    <p>
                                        ${escapeHTML(
                                            complaint.description ||
                                            "No description recorded."
                                        )}
                                    </p>

                                </div>


                                <div>

                                    <strong>
                                        ${escapeHTML(
                                            homeStatusLabel(
                                                complaint
                                            )
                                        )}
                                    </strong>


                                    <button
                                        type="button"
                                        onclick="openCase(${Number(
                                            complaint.complaint_id
                                        )})"
                                    >
                                        OPEN FILE →
                                    </button>

                                </div>

                            </article>

                        `).join("")}

                    </div>

                </section>

            </div>

        `;
    }


    /* ---------------------------------------------
       SHOW EXISTING CASE POPUP
       --------------------------------------------- */

    overlay.hidden = false;

    document.body.classList.add("case-open");
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
