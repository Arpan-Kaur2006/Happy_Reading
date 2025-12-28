// --- STATE & INIT ---
let books = JSON.parse(localStorage.getItem("books")) || [];
let categories = JSON.parse(localStorage.getItem("categories")) || ["Fiction", "Non-fiction", "Technical", "Philosophy", "General"];

// Theme Init
if (localStorage.getItem("theme") === "dark") {
    document.body.setAttribute("data-theme", "dark");
}

// Migration: Ensure all books have IDs
let hasChanges = false;
books.forEach(b => {
    if (!b.id) {
        b.id = "legacy_" + Date.now() + Math.random().toString(36).substr(2, 9);
        hasChanges = true;
    }
});
if (hasChanges) {
    localStorage.setItem("books", JSON.stringify(books));
}

init();

function init() {
    renderCategories();
    renderBooks();
    updateStats();
}

// --- VIEW NAVIGATION ---
function switchView(viewName) {
    document.querySelectorAll('.main-content > div').forEach(el => el.classList.add('hidden'));
    document.getElementById(`view-${viewName}`).classList.remove('hidden');

    document.querySelectorAll('.nav-item').forEach(el => el.classList.remove('active'));
    document.querySelector(`.nav-item[onclick="switchView('${viewName}')"]`).classList.add('active');
}

function toggleTheme() {
    let current = document.body.getAttribute("data-theme");
    if (current === "dark") {
        document.body.removeAttribute("data-theme");
        localStorage.setItem("theme", "light");
    } else {
        document.body.setAttribute("data-theme", "dark");
        localStorage.setItem("theme", "dark");
    }
}

// --- BOOK MANAGEMENT ---
function showUploadModal() {
    document.getElementById('uploadModal').classList.remove('hidden');
    renderCategoryOptions();
}

function hideUploadModal() {
    document.getElementById('uploadModal').classList.add('hidden');
}

function renderCategoryOptions() {
    const select = document.getElementById("categorySelect");
    select.innerHTML = categories.map(c => `<option value="${c}">${c}</option>`).join('');
}

async function uploadBook() {
    let fileInput = document.getElementById("pdfUpload");
    let file = fileInput.files?.[0];
    let category = document.getElementById("categorySelect").value;

    if (!file) return alert("Please select a file");

    let id = Date.now().toString();
    let fileType = file.name.toLowerCase().endsWith(".epub") ? "epub" : "pdf";

    try {
        await saveFile(id, file);

        // Generate Cover
        let coverBlob = null;
        try {
            coverBlob = await generateCover(file, fileType);
            if (coverBlob) await saveFile(id + "_cover", coverBlob);
        } catch (e) {
            console.warn("Could not generate cover", e);
        }

        let book = {
            id: id,
            name: file.name.replace(/\.(pdf|epub)$/i, ""),
            fileType: fileType,
            category: category,
            currentPage: 0, // For PDF: page num, For EPUB: cfi
            totalPages: 0,
            status: "to-read",
            addedDate: Date.now(),
            lastReadDate: null,
            progressPercent: 0,
            hasCover: !!coverBlob
        };

        books.push(book);
        saveBooks();
        renderBooks();
        updateStats();
        hideUploadModal();
        fileInput.value = ""; // Reset
    } catch (err) {
        console.error(err);
        alert("Failed to save book: " + err.message);
    }
}

// --- COVER GENERATION ---
async function generateCover(file, type) {
    if (type === 'pdf') return generatePDFCover(file);
    if (type === 'epub') return generateEPUBCover(file);
    return null;
}

async function generatePDFCover(file) {
    const fileURL = URL.createObjectURL(file);
    const pdf = await pdfjsLib.getDocument(fileURL).promise;
    const page = await pdf.getPage(1);
    const viewport = page.getViewport({ scale: 1.0 });

    const canvas = document.createElement("canvas");
    canvas.width = viewport.width;
    canvas.height = viewport.height;
    const ctx = canvas.getContext("2d");

    await page.render({ canvasContext: ctx, viewport: viewport }).promise;

    return new Promise(resolve => canvas.toBlob(resolve, 'image/jpeg', 0.8));
}

async function generateEPUBCover(file) {
    return new Promise((resolve, reject) => {
        const book = ePub(file);
        book.loaded.cover.then(coverUrl => {
            if (coverUrl) {
                // If cover is found, we need to fetch it to get a blob
                book.archive.createUrl(coverUrl).then(url => {
                    fetch(url).then(r => r.blob()).then(resolve).catch(() => resolve(null));
                });
            } else {
                // Fallback: render first page? Too complex for now, return null to show icon
                resolve(null);
            }
        }).catch(() => resolve(null));
    });
}

function saveBooks() {
    localStorage.setItem("books", JSON.stringify(books));
}

// --- RENDERING ---
function renderBooks() {
    // Percentage Logic
    const toRead = books.filter(b => (b.progressPercent || 0) < 5);
    const reading = books.filter(b => (b.progressPercent || 0) >= 5 && (b.progressPercent || 0) <= 90);
    const finished = books.filter(b => (b.progressPercent || 0) > 90);

    // 1. Dashboard Sections
    const renderSection = (id, list) => {
        const container = document.getElementById(id);
        if (!container) return; // Guard for library view
        container.innerHTML = list.length ? "" : "<p class='text-muted'>No books.</p>";
        list.slice(0, 4).forEach(b => container.appendChild(createBookCard(b))); // Show max 4 in dash
    };

    renderSection("dash-toread", toRead);
    renderSection("dash-reading", reading);
    renderSection("dash-finished", finished);

    // 2. Library Full Lists (Existing view-library logic)
    // We can keep the existing 'status' property or infer it. 
    // To minimize confusion, let's just re-use the percentage lists for consistency
    const libraryContainer = document.getElementById("library-content");
    libraryContainer.innerHTML = "";

    const addLibrarySection = (title, list) => {
        if (list.length === 0) return;
        const sectionDiv = document.createElement("div");
        sectionDiv.innerHTML = `<h2>${title}</h2><div class="book-grid"></div>`;
        const grid = sectionDiv.querySelector(".book-grid");
        list.forEach(b => grid.appendChild(createBookCard(b)));
        libraryContainer.appendChild(sectionDiv);
    };

    addLibrarySection("Currently Reading", reading);
    addLibrarySection("To Read", toRead);
    addLibrarySection("Finished", finished);
}

function createBookCard(b) {
    const div = document.createElement("div");
    div.className = "book-card";

    // Calculate display percentages
    let percent = b.progressPercent || 0;

    // Icon based on type
    let icon = b.fileType === "epub" ? "📖" : "📄";

    div.innerHTML = `
        <div class="book-cover-container" id="cover-${b.id}">
            <div class="book-cover-placeholder">${icon}</div>
        </div>
        <div class="book-details">
            <div class="book-title" title="${b.name}">${b.name}</div>
            <div class="book-category">${b.category || 'General'}</div>
            
            <div class="progress-bar">
                <div class="progress-fill" style="width: ${percent}%"></div>
            </div>
            <div style="font-size: 0.8rem; color: var(--text-muted); margin-bottom: 8px;">
                ${percent}% Complete
            </div>

            <button class="read-btn" onclick="openBook('${b.id}')">
                ${b.status === 'completed' ? 'Read Again' : 'Continue Reading'}
            </button>
            <button class="delete-btn" onclick="requestDelete('${b.id}', event)">🗑️</button>
        </div>
    `;

    // Async load cover
    if (b.hasCover) {
        getFile(b.id + "_cover").then(blob => {
            if (blob) {
                const url = URL.createObjectURL(blob);
                const container = div.querySelector(`#cover-${b.id}`);
                container.innerHTML = `<img src="${url}" alt="Cover" style="width:100%; height:100%; object-fit:cover;">`;
            }
        });
    }

    return div;
}

let pendingDeleteId = null;

function requestDelete(id, event) {
    if (event) event.stopPropagation();
    pendingDeleteId = id;
    document.getElementById("deleteModal").classList.remove("hidden");
}

function hideDeleteModal() {
    document.getElementById("deleteModal").classList.add("hidden");
    pendingDeleteId = null;
}

async function confirmDelete() {
    if (!pendingDeleteId) return;

    const id = pendingDeleteId;
    hideDeleteModal(); // Close immediately for responsiveness

    try {
        // Remove from IndexedDB
        await deleteFile(id);
        await deleteFile(id + "_cover");

        // Remove from books array
        books = books.filter(b => b.id !== id);
        saveBooks();

        // Update UI
        renderBooks();
        updateStats();
    } catch (err) {
        console.error(err);
        alert("Error deleting book: " + err.message);
    }
}

// Close modals on Escape key
document.addEventListener('keydown', (e) => {
    if (e.key === "Escape") {
        hideUploadModal();
        hideDeleteModal();
    }
});

function openBook(id) {
    window.location.href = `reader.html?id=${id}`;
}

// --- STATS & CATEGORIES ---
function updateStats() {
    // Total Books
    document.getElementById("stat-books").innerText = books.length;

    // Pages Read (Approximation for EPUBs, exact for PDFs)
    // We assume 1% progress ~ 2 pages if totalPages is 0 (EPUB issue), otherwise use calculation
    let totalPagesRead = books.reduce((acc, b) => {
        if (b.status === 'completed' && b.totalPages) return acc + b.totalPages;
        if (b.totalPages) return acc + b.currentPage;
        return acc + Math.round((b.progressPercent || 0) * 2); // Fallback estimate
    }, 0);
    document.getElementById("stat-pages").innerText = totalPagesRead;

    // Streak Logic (Check unique days in 'activeDates' if we tracked them, but for now we'll mock it or implement simple logic)
    // Let's rely on checking 'lastReadDate'. 
    // Real implementation requires logging every day read. We'll simplify: 
    // If lastReadDate is today, streak is valid. If yesterday, valid. Else 0.
    // For now, let's just show "1" if active today.
    // TODO: Implement robust streak tracking in a separate object.
}

// Category Management (Minimal)
// Category Management (Kanban)
function renderCategories() {
    const list = document.getElementById("categories-list");
    list.className = "kanban-board"; // Apply flex layout
    list.innerHTML = "";

    categories.forEach(cat => {
        const col = document.createElement("div");
        col.className = "category-column";

        // Find books in this category
        const catBooks = books.filter(b => (b.category || "General") === cat);

        col.innerHTML = `
            <div class="column-header">
                ${cat} <span style="font-size:0.8em; opacity:0.7">${catBooks.length}</span>
            </div>
            <div class="column-content" ondrop="dropBook(event, '${cat}')" ondragover="allowDrop(event)" ondragleave="leaveDrop(event)">
                <!-- Books go here -->
            </div>
        `;

        const content = col.querySelector(".column-content");
        catBooks.forEach(b => {
            content.appendChild(createMiniBook(b));
        });

        list.appendChild(col);
    });
}

function createMiniBook(b) {
    const div = document.createElement("div");
    div.className = "mini-book-card";
    div.draggable = true;
    div.ondragstart = (ev) => dragStart(ev, b.id);

    let icon = b.fileType === "epub" ? "📖" : "📄";

    div.innerHTML = `
        <div class="mini-cover">${icon}</div>
        <div class="mini-details">
            <div class="mini-title">${b.name}</div>
        </div>
    `;
    return div;
}

// Drag & Drop Handlers
function allowDrop(ev) {
    ev.preventDefault();
    ev.currentTarget.classList.add("drag-over");
}

function leaveDrop(ev) {
    ev.currentTarget.classList.remove("drag-over");
}

function dragStart(ev, id) {
    ev.dataTransfer.setData("bookId", id);
}

function dropBook(ev, category) {
    ev.preventDefault();
    ev.currentTarget.classList.remove("drag-over");

    const id = ev.dataTransfer.getData("bookId");
    const book = books.find(b => b.id === id);

    if (book && book.category !== category) {
        book.category = category;
        saveBooks();
        renderCategories(); // Re-render board

        // Optional: show feedback or animate
    }
}

function addCategory() {
    const name = prompt("Enter category name:");
    if (name && !categories.includes(name)) {
        categories.push(name);
        localStorage.setItem("categories", JSON.stringify(categories));
        renderCategories();
    }
}


