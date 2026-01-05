// ----- GLOBAL CONSTANTS -----
const ADD_OTP_API = '/add-account-otp/';
const VERIFY_OTP_API = '/verify-otp/';
const ACCOUNTS_API = '/accounts/';
const MEDIA_API = '/media-list';
const POST_TO_GROUP_API = '/post-to-group/';
const JOIN_GROUP_API = '/join-group/';
const UPDATE_NAME_API = '/update-name/';
const UPDATE_USERNAME_API = '/update-username/';
const UPDATE_PHOTO_API = '/update-photo/';
const MARK_POSTED_API = '/mark-posted/';
const ANALYTICS_API = '/analytics/';
const CLEAR_ANALYTICS_API = '/analytics/clear/';
const SCHEDULE_API = '/schedules/';
const BOT_SETTINGS_API = '/bot-settings/';
const TEST_BOT_API = '/test-bot-message/';

// ----- GLOBAL VARIABLES -----
let accounts = [];
let mediaItems = [];
let finalAssignments = [];
let currentTheme = 'light';
// Track accounts that were updated during this page session (cleared on explicit refresh)
let recentlyUpdatedAccounts = new Set();

// ----- THEME MANAGEMENT -----
function initTheme() {
    const savedTheme = localStorage.getItem('theme') || 'light';
    setTheme(savedTheme);

    const themeToggle = document.getElementById('themeToggle');
    if (themeToggle) {
        themeToggle.addEventListener('click', toggleTheme);
    }
}

function setTheme(theme) {
    currentTheme = theme;
    document.documentElement.setAttribute('data-theme', theme);
    localStorage.setItem('theme', theme);

    const themeIcon = document.querySelector('#themeToggle i');
    if (themeIcon) {
        themeIcon.className = theme === 'dark' ? 'fas fa-sun' : 'fas fa-moon';
    }
}

function toggleTheme() {
    const newTheme = currentTheme === 'light' ? 'dark' : 'light';
    setTheme(newTheme);
}

// ----- TOAST SYSTEM -----
function toast(msg, type = 'success') {
    const container = document.getElementById('toastContainer') || document.body;
    const el = document.createElement('div');
    el.className = `toast ${type}`;

    const icons = {
        success: 'fas fa-check-circle',
        error: 'fas fa-exclamation-circle',
        warning: 'fas fa-exclamation-triangle',
        info: 'fas fa-info-circle'
    };

    el.innerHTML = `<i class="${icons[type] || icons.success}"></i><div>${msg}</div>`;
    container.appendChild(el);

    // reveal
    requestAnimationFrame(() => el.classList.add('show'));

    // remove after timeout
    setTimeout(() => {
        el.classList.remove('show');
        setTimeout(() => el.remove(), 300);
    }, 3500);
}

// ----- TAB MANAGEMENT -----
function initTabs() {
    const tabButtons = document.querySelectorAll('.nav-btn');
    const sections = document.querySelectorAll('.content-section');

    tabButtons.forEach(button => {
        button.addEventListener('click', () => {
            const targetTab = button.getAttribute('data-tab');

            // Update active tab
            tabButtons.forEach(btn => btn.classList.remove('active'));
            button.classList.add('active');

            // Show target section
            sections.forEach(section => {
                section.classList.remove('active');
                if (section.id === `section${targetTab.charAt(0).toUpperCase() + targetTab.slice(1)}`) {
                    section.classList.add('active');
                }
            });

            // Hide overlay jika user pindah menu dari Kirim Pesan
            const loadingOverlayBg = document.getElementById('sendLoadingOverlay');
            if (targetTab !== 'send' && loadingOverlayBg) {
                loadingOverlayBg.style.display = 'none';
            }

            // Update Topbar Title
            const tabTitles = {
                'accounts': 'Dashboard Overview',
                'send': 'Pengiriman Pesan',
                'join': 'Auto-Join Groups',
                'media': 'Media & Captions',
                'schedule': 'Auto Schedule Bot',
                'swap': 'Profile Management',
                'analytics': 'Detailed Analytics'
            };
            document.getElementById('currentSectionTitle').textContent = tabTitles[targetTab] || 'Auto Post';

            // Load section-specific data
            loadSectionData(targetTab);
        });
    });
}

// Global cache to prevent redundant loading
let lastLoadTime = {};
const CACHE_TTL = 5000; // 5 seconds cache

async function loadSectionData(targetTab) {
    try {
        switch (targetTab) {
            case 'accounts': await loadAccounts(); break;
            case 'send': await Promise.all([loadAccounts(), loadMedia()]); initSendForm(); break;
            case 'media': await loadMedia(); break;
            case 'analytics': await loadAnalytics(); break;
            case 'join': await loadAccounts(); populateJoinAccounts(); break;
            case 'schedule':
                await Promise.all([loadSchedules(), loadBotSettings()]);
                initScheduleForm();
                break;
        }
    } catch (err) {
        console.error('Crash in loadSectionData:', err);
    }
}

// Dummy function for initMediaForm if it doesn't exist in other parts of the code
function initMediaForm() {
    // Placeholder for any media section specific form initializations
    // e.g., event listeners for upload forms, etc.
    // The existing initUploadHandlers() might be considered part of this.
}


async function updateDashboardStats() {
    try {
        // Total Accounts
        if (document.getElementById('statTotalAccounts')) {
            document.getElementById('statTotalAccounts').textContent = accounts.length;
        }

        // Total Media
        if (document.getElementById('statTotalMedia')) {
            document.getElementById('statTotalMedia').textContent = mediaItems.length;
        }

        // Active Schedules
        const schedRes = await fetch(SCHEDULE_API);
        if (schedRes.ok) {
            const schedules = await schedRes.json();
            const activeCount = schedules.filter(s => s.active).length;
            if (document.getElementById('statActiveSchedule')) {
                document.getElementById('statActiveSchedule').textContent = activeCount;
            }
        }

        // Analytics Stats
        const res = await fetch(ANALYTICS_API);
        if (res.ok) {
            const data = await res.json();
            let totalSuccess = 0;
            let totalFailed = 0;

            if (data.accounts) {
                Object.values(data.accounts).forEach(acc => {
                    Object.values(acc.groups).forEach(grp => {
                        totalSuccess += Math.max(0, grp.success || 0);
                        totalFailed += Math.max(0, grp.failed || 0);
                    });
                });
            }

            if (document.getElementById('statTotalSuccess')) {
                document.getElementById('statTotalSuccess').textContent = totalSuccess;
            }
            if (document.getElementById('statTotalFailed')) {
                document.getElementById('statTotalFailed').textContent = totalFailed;
            }
        }
    } catch (err) {
        console.error('Error updating dashboard stats:', err);
    }
}

// ----- ACCOUNTS MANAGEMENT -----
async function loadAccounts() {
    try {
        showLoading('accountList', 'Memuat akun...');

        const res = await fetch(ACCOUNTS_API);
        if (!res.ok) throw new Error('Failed to fetch accounts');

        accounts = await res.json();
        // Render main list and swap lists. Do not clear the recentlyUpdatedAccounts here by default;
        // callers can pass true to clear if they want a manual "refresh" that removes markers.
        renderAccountList(document.getElementById('accountList'), false);
        populateSwapAccounts();
        renderAccountList(document.getElementById('swapAccountList'), true);

        await updateDashboardStats();
    } catch (error) {
        console.error('Error loading accounts:', error);
        toast('Gagal memuat daftar akun', 'error');
        showError('accountList', 'Gagal memuat akun');
    }
}

function renderAccountList(element, isSwapList = false) {
    if (!element) return;

    element.innerHTML = '';

    if (!accounts.length) {
        element.innerHTML = '<li class="list-placeholder muted">Belum ada akun yang terdaftar</li>';
        return;
    }

    accounts.forEach(acc => {
        const li = document.createElement('li');
        li.className = 'account-item';

        if (isSwapList) {
            // For swap list, show more details and optionally mark recently updated accounts
            const isUpdated = recentlyUpdatedAccounts.has(String(acc.id));
            if (isUpdated) li.classList.add('recently-updated');

            li.innerHTML = `
                <div class="account-info">
                    <div class="account-main">${acc.id} | ${acc.phone} | ${acc.username || '-'}</div>
                    <div class="account-sub">${acc.first_name || '-'} ${acc.last_name || ''}</div>
                </div>
                ${isUpdated ? '<span class="updated-badge" title="Baru diupdate">&nbsp;✓&nbsp;</span>' : ''}
            `;
            li.title = `Klik untuk detail akun ${acc.id}`;
        } else {
            li.textContent = `${acc.id} | ${acc.phone} | ${acc.username || '-'}`;
            li.title = `Klik untuk detail akun ${acc.id}`;
        }

        element.appendChild(li);
    });
}

function populateSwapAccounts() {
    const selects = [document.getElementById('swapAccountIdName'), document.getElementById('swapAccountIdPhoto')];

    selects.forEach(select => {
        if (!select) return;

        select.innerHTML = '<option value="">Pilih akun...</option>';
        accounts.forEach(acc => {
            const option = document.createElement('option');
            option.value = acc.id;
            option.textContent = `${acc.id} | ${acc.phone} | ${acc.username || 'No username'}`;
            select.appendChild(option);
        });
    });
}

// ----- MEDIA MANAGEMENT -----
async function loadMedia() {
    try {
        showLoading('mediaList', 'Memuat media...');

        const res = await fetch(MEDIA_API);
        if (!res.ok) throw new Error('Failed to fetch media');

        mediaItems = await res.json();
        renderMediaList();
        await updateDashboardStats();
    } catch (error) {
        console.error('Error loading media:', error);
        toast('Gagal memuat daftar media', 'error');
        showError('mediaList', 'Gagal memuat media');
    }
}

function renderMediaList() {
    const mediaList = document.getElementById('mediaList');
    if (!mediaList) return;

    mediaList.innerHTML = '';

    if (!mediaItems.length) {
        mediaList.innerHTML = '<li class="list-placeholder muted">Belum ada media yang tersedia</li>';
        return;
    }

    mediaItems.forEach(media => {
        const li = document.createElement('li');
        li.className = 'media-item';

        const thumb = document.createElement('img');
        thumb.alt = media.file;
        thumb.src = media.thumbnail || `/media/${encodeURIComponent(media.file)}`;
        thumb.loading = 'lazy';

        const meta = document.createElement('div');
        meta.className = 'media-content';
        meta.innerHTML = `<strong>${media.file}</strong><div class="media-caption">${media.caption || 'Tidak ada caption'}</div>`;

        const copyIcon = document.createElement('i');
        copyIcon.className = 'fas fa-copy copy-icon';
        copyIcon.title = 'Salin caption';

        copyIcon.addEventListener('click', async (e) => {
            e.stopPropagation();
            try {
                await navigator.clipboard.writeText(media.caption || '');
                toast('Caption berhasil disalin', 'success');
                const prev = copyIcon.className;
                copyIcon.className = 'fas fa-check copy-icon';
                setTimeout(() => copyIcon.className = prev, 1500);
            } catch (err) {
                toast('Gagal menyalin caption', 'error');
            }
        });

        thumb.addEventListener('click', () => showImagePreview(thumb.src, media.caption || ''));

        li.appendChild(thumb);
        li.appendChild(meta);
        li.appendChild(copyIcon);
        mediaList.appendChild(li);
    });
}

// Image preview helpers
function showImagePreview(src, caption) {
    const modal = document.getElementById('imagePreviewModal');
    const previewImg = document.getElementById('previewImage');
    const previewCaption = document.getElementById('previewCaption');
    if (!modal || !previewImg) return;

    previewImg.src = src;
    previewCaption.textContent = caption || '';
    modal.setAttribute('aria-hidden', 'false');
}

function hideImagePreview() {
    const modal = document.getElementById('imagePreviewModal');
    const previewImg = document.getElementById('previewImage');
    if (!modal || !previewImg) return;

    modal.setAttribute('aria-hidden', 'true');
    previewImg.src = '';
}

// ----- FORM HANDLERS -----
function initForms() {
    initAddAccountForm();
    initVerifyOtpForm();
    initSendForm();
    initSwapForms();
    initFileUpload();
    initUploadHandlers();
    initAnalyticsForm();
    initJoinForm();
    initScheduleForm(); // Ensure schedule form is initialized
}

function initJoinForm() {
    const form = document.getElementById('bulkJoinForm');
    if (!form) return;
    
    // Prevent duplicate initialization
    if (form.dataset.initialized === 'true') return;

    form.addEventListener('submit', async (e) => {
        e.preventDefault();
        await runBulkJoin();
    });
    
    form.dataset.initialized = 'true';
}

function populateJoinAccounts() {
    const container = document.getElementById('joinAccountSelect');
    if (!container) return;

    container.innerHTML = '';
    if (!accounts.length) {
        container.innerHTML = '<div class="muted">Tidak ada akun tersedia</div>';
        return;
    }

    // Add "Select All" Option
    const selectAll = document.createElement('label');
    selectAll.className = 'checkbox-item select-all';
    selectAll.innerHTML = `<input type="checkbox" id="selectAllJoin"> <span><strong>Pilih Semua Akun</strong></span>`;
    container.appendChild(selectAll);

    selectAll.querySelector('input').addEventListener('change', (e) => {
        container.querySelectorAll('input.acc-checkbox').forEach(cb => cb.checked = e.target.checked);
    });

    accounts.forEach(acc => {
        const label = document.createElement('label');
        label.className = 'checkbox-item';
        label.innerHTML = `
            <input type="checkbox" class="acc-checkbox" value="${acc.id}">
            <span>${acc.id} (${acc.phone})</span>
        `;
        container.appendChild(label);
    });
}

async function runBulkJoin() {
    const linksText = document.getElementById('joinLinks').value;
    const delaySec = parseInt(document.getElementById('joinDelay').value) || 5;
    const logContainer = document.getElementById('joinLog');
    const submitBtn = document.querySelector('#bulkJoinForm button');

    const selectedAccounts = Array.from(document.querySelectorAll('input.acc-checkbox:checked')).map(cb => cb.value);
    const links = linksText.split('\n').map(l => l.trim()).filter(l => l !== '');

    if (!selectedAccounts.length) return toast('Pilih minimal satu akun', 'error');
    if (!links.length) return toast('Masukkan minimal satu link grup', 'error');

    submitBtn.disabled = true;
    logContainer.innerHTML = `<div class="log-info">Memulai proses join untuk ${selectedAccounts.length} akun ke ${links.length} grup...</div>`;

    let isCancelled = false;

    for (const link of links) {
        addLog(logContainer, `Target Group: ${link}`, 'header');

        for (const accId of selectedAccounts) {
            addLog(logContainer, `[${accId}] Mencoba bergabung...`, 'info');

            try {
                const fd = new FormData();
                fd.append('account_id', accId);
                fd.append('group', link);

                const res = await fetch(JOIN_GROUP_API, { method: 'POST', body: fd });
                const data = await res.json();

                if (res.ok) {
                    addLog(logContainer, `[${accId}] ${data.status}`, data.already_member ? 'warning' : 'success');
                } else {
                    addLog(logContainer, `[${accId}] Gagal: ${data.detail || 'Error unknown'}`, 'error');
                }
            } catch (err) {
                addLog(logContainer, `[${accId}] Network Error: ${err.message}`, 'error');
            }

            // Delay per account
            addLog(logContainer, `Menunggu ${delaySec} detik...`, 'muted');
            await new Promise(resolve => setTimeout(resolve, delaySec * 1000));
        }
    }

    addLog(logContainer, 'Semua proses selesai!', 'success');
    submitBtn.disabled = false;
}

function addLog(container, msg, type = 'info') {
    const entry = document.createElement('div');
    entry.className = `log-entry ${type}`;
    const time = new Date().toLocaleTimeString();
    entry.innerHTML = `<span class="log-time">[${time}]</span> ${msg}`;
    container.prepend(entry); // Newest on top
}

function initAddAccountForm() {
    const form = document.getElementById('addAccountForm');
    if (!form) return;

    const submitBtn = form.querySelector('button[type="submit"]');
    const buttonText = form.querySelector('#button-text');
    const spinner = form.querySelector('.btn-spinner');
    const alert = form.querySelector('.form-alert');

    form.addEventListener('submit', async (e) => {
        e.preventDefault();
        setFormLoading(submitBtn, buttonText, spinner, true);
        hideAlert(alert);

        const formData = {
            id: document.getElementById('newId')?.value.trim(),
            phone: document.getElementById('newPhone')?.value.trim(),
            api_id: parseInt(document.getElementById('newApiId')?.value || '0'),
            api_hash: document.getElementById('newApiHash')?.value.trim()
        };

        // Validation
        if (!formData.id || !formData.phone || !formData.api_id || !formData.api_hash) {
            showAlert(alert, 'Semua field harus diisi', 'error');
            setFormLoading(submitBtn, buttonText, spinner, false);
            return;
        }

        try {
            const res = await fetch(ADD_OTP_API, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(formData)
            });

            const result = await res.json();

            if (res.ok) {
                toast('OTP berhasil dikirim. Periksa aplikasi Telegram Anda.', 'success');
                showOtpModal(result.account_id);
                form.reset();
            } else {
                showAlert(alert, result.detail || 'Terjadi kesalahan', 'error');
            }
        } catch (error) {
            console.error('Error adding account:', error);
            showAlert(alert, 'Gagal terhubung ke server. Pastikan server berjalan.', 'error');
        } finally {
            setFormLoading(submitBtn, buttonText, spinner, false);
        }
    });
}

function initVerifyOtpForm() {
    const form = document.getElementById('verifyOtpForm');
    if (!form) return;

    form.addEventListener('submit', async (e) => {
        e.preventDefault();

        const submitBtn = form.querySelector('button[type="submit"]');
        const alert = form.querySelector('.form-alert');

        submitBtn.disabled = true;
        hideAlert(alert);

        const formData = new FormData(form);

        try {
            const res = await fetch(VERIFY_OTP_API, {
                method: 'POST',
                body: formData
            });

            const result = await res.json();

            if (res.ok) {
                toast('Akun berhasil ditambahkan dan diverifikasi!', 'success');
                hideOtpModal();
                form.reset();
                await loadAccounts();
            } else {
                showAlert(alert, result.detail || 'Kode OTP salah', 'error');
            }
        } catch (error) {
            console.error('Error verifying OTP:', error);
            showAlert(alert, 'Gagal verifikasi OTP. Periksa koneksi internet.', 'error');
        } finally {
            submitBtn.disabled = false;
        }
    });
}

function initSendForm() {
    const form = document.getElementById('sendForm');
    if (!form) return;
    
    // Prevent duplicate event listeners
    if (form.dataset.initialized === 'true') return;

    const previewBtn = document.getElementById('previewAssignBtn');

    // Preview assignments
    previewBtn?.addEventListener('click', generateAssignments);

    // Send messages
    form.addEventListener('submit', async (e) => {
        e.preventDefault();
        await sendMessages();
    });
    
    form.dataset.initialized = 'true';
}

function initSwapForms() {
    // Update name and username
    const nameForm = document.getElementById('swapFormName');
    if (nameForm && nameForm.dataset.initialized !== 'true') {
        nameForm?.addEventListener('submit', async (e) => {
            e.preventDefault();
            await updateProfile();
        });
        nameForm.dataset.initialized = 'true';
    }

    // Update photo
    const photoForm = document.getElementById('swapFormPhoto');
    if (photoForm && photoForm.dataset.initialized !== 'true') {
        photoForm?.addEventListener('submit', async (e) => {
            e.preventDefault();
            await updatePhoto();
        });
        photoForm.dataset.initialized = 'true';
    }
}

function initFileUpload() {
    const fileInput = document.getElementById('swapPhoto');
    const uploadArea = document.getElementById('fileUploadArea');
    const fileNameDisplay = document.getElementById('fileName');

    if (!fileInput || !uploadArea) return;
    
    // Prevent duplicate initialization
    if (uploadArea.dataset.initialized === 'true') return;

    // Click handler
    uploadArea.addEventListener('click', () => fileInput.click());

    // Drag and drop
    uploadArea.addEventListener('dragover', (e) => {
        e.preventDefault();
        uploadArea.classList.add('dragover');
    });

    uploadArea.addEventListener('dragleave', () => {
        uploadArea.classList.remove('dragover');
    });

    uploadArea.addEventListener('drop', (e) => {
        e.preventDefault();
        uploadArea.classList.remove('dragover');

        const files = e.dataTransfer.files;
        if (files.length > 0) {
            fileInput.files = files;
            handleFileSelect(files[0]);
        }
    });

    // File selection
    fileInput.addEventListener('change', (e) => {
        if (e.target.files.length > 0) {
            handleFileSelect(e.target.files[0]);
        }
    });
    
    uploadArea.dataset.initialized = 'true';
}

function handleFileSelect(file) {
    const fileNameDisplay = document.getElementById('fileName');
    if (!fileNameDisplay) return;

    if (file && file.type.startsWith('image/')) {
        fileNameDisplay.textContent = `File terpilih: ${file.name} (${(file.size / 1024).toFixed(2)} KB)`;
        fileNameDisplay.className = 'file-name-display show success';
    } else {
        fileNameDisplay.textContent = 'Harap pilih file gambar yang valid';
        fileNameDisplay.className = 'file-name-display show error';
    }
}

// ----- ASSIGNMENT & SENDING -----
async function generateAssignments() {
    const previewBtn = document.getElementById('previewAssignBtn');
    const assignmentList = document.getElementById('assignmentList');

    if (!previewBtn || !assignmentList) return;

    previewBtn.disabled = true;

    try {
        // Ensure we have the latest data
        await loadAccounts();
        await loadMedia();

        if (!accounts.length) {
            toast('Belum ada akun yang terdaftar', 'error');
            return;
        }

        if (!mediaItems.length) {
            toast('Belum ada media yang tersedia', 'error');
            return;
        }

        // Load captions if not already loaded
        if (!window.captions) {
            try {
                const res = await fetch('/captions/captions.txt');
                if (res.ok) {
                    const text = await res.text();
                    window.captions = text.split(/\r?\n/)
                        .map(line => line.trim())
                        .filter(line => line !== '');
                } else {
                    throw new Error('Captions file not found');
                }
            } catch (error) {
                console.error('Error loading captions:', error);
                toast('Gagal memuat file captions', 'error');
                return;
            }
        }

        const strategy = document.getElementById('strategy')?.value || 'sequential';
        const uniqueMedia = [...new Map(mediaItems.map(m => [m.file, m])).values()];
        const uniqueCaptions = [...new Set(window.captions)];

        if (uniqueMedia.length < accounts.length) {
            toast(`Jumlah media unik (${uniqueMedia.length}) kurang dari jumlah akun (${accounts.length})`, 'error');
            return;
        }

        if (uniqueCaptions.length < accounts.length) {
            toast(`Jumlah caption unik (${uniqueCaptions.length}) kurang dari jumlah akun (${accounts.length})`, 'error');
            return;
        }

        let assignedMedia, assignedCaptions;

        if (strategy === 'random') {
            assignedMedia = shuffleArray([...uniqueMedia]).slice(0, accounts.length);
            assignedCaptions = shuffleArray([...uniqueCaptions]).slice(0, accounts.length);
        } else {
            assignedMedia = uniqueMedia.slice(0, accounts.length);
            assignedCaptions = uniqueCaptions.slice(0, accounts.length);
        }

        finalAssignments = accounts.map((account, index) => ({
            account_id: account.id,
            media: assignedMedia[index],
            caption: assignedCaptions[index]
        }));

        // Render assignment preview
        assignmentList.innerHTML = '';
        finalAssignments.forEach(assignment => {
            const li = document.createElement('li');
            li.className = 'assignment-item';
            li.innerHTML = `
                <div class="assignment-account">${assignment.account_id}</div>
                <div class="assignment-arrow">→</div>
                <div class="assignment-details">
                    <div class="assignment-file">${assignment.media.file}</div>
                    <div class="assignment-caption">${assignment.caption.substring(0, 50)}...</div>
                </div>
            `;
            assignmentList.appendChild(li);
        });

        toast(`Preview penugasan berhasil dibuat untuk ${accounts.length} akun`, 'success');

    } catch (error) {
        console.error('Error generating assignments:', error);
        toast('Gagal membuat preview penugasan', 'error');
    } finally {
        previewBtn.disabled = false;
    }
}

async function sendMessages() {
    const sendBtn = document.querySelector('#sendForm button[type="submit"]');
    const loadingOverlay = document.getElementById('sendLoading');
    const loadingOverlayBg = document.getElementById('sendLoadingOverlay');
    const loadingText = document.getElementById('sendLoadingText');
    const progressText = document.getElementById('sendProgress');
    const cancelBtn = document.getElementById('cancelSend');
    const minimizeBtn = document.getElementById('minimizeSend');
    const closeBtn = document.getElementById('closeSend');
    const backgroundIndicator = document.getElementById('backgroundProcessIndicator');
    const backgroundText = document.getElementById('backgroundProcessText');
    const loadingSpinner = document.getElementById('loadingSpinner');
    const successMessage = document.getElementById('successMessage');
    const successDetails = document.getElementById('successDetails');
    const showModalBtn = document.getElementById('showModalBtn');

    if (!finalAssignments || finalAssignments.length === 0) {
        toast('Harap buat preview penugasan terlebih dahulu', 'error');
        return;
    }

    const groupA = document.getElementById('groupSend')?.value.trim();
    const groupB = document.getElementById('groupSend2')?.value.trim();

    if (!groupA) {
        toast('Harap masukkan username/ID group utama', 'error');
        return;
    }

    const delayMinutes = parseFloat(document.getElementById('delaySend')?.value || '1');
    const delayMs = delayMinutes * 60 * 1000;

    let cancelled = false;

    // Setup cancellation
    cancelBtn.onclick = () => {
        cancelled = true;
        loadingText.textContent = 'Membatalkan pengiriman...';
    };

    // Setup minimize button
    minimizeBtn.onclick = () => {
        loadingOverlay.style.display = 'none';
        loadingOverlayBg.style.display = 'none';
        backgroundIndicator.style.display = 'flex';
    };

    // Setup close button (setelah selesai)
    closeBtn.onclick = () => {
        loadingOverlay.style.display = 'none';
        loadingOverlayBg.style.opacity = '0';
        setTimeout(() => {
            loadingOverlayBg.style.display = 'none';
        }, 300);
        backgroundIndicator.style.display = 'none';
        sendBtn.disabled = false;
    };

    // Setup show modal button (ketika disembunyikan)
    showModalBtn.onclick = () => {
        loadingOverlay.style.display = 'flex';
        loadingOverlayBg.style.display = 'block';
        setTimeout(() => {
            loadingOverlayBg.style.opacity = '1';
        }, 0);
    };

    // Show modal centered with overlay (only visible in send menu)
    sendBtn.disabled = true;
    loadingOverlay.style.display = 'flex';
    loadingOverlayBg.style.display = 'block';
    setTimeout(() => {
        loadingOverlayBg.style.opacity = '1';
    }, 0);
    backgroundIndicator.style.display = 'flex';

    // Track which images have been successfully posted to all groups
    // Key: "filename|caption", Value: true if already marked as posted
    const postedImages = new Map();

    try {
        for (let i = 0; i < finalAssignments.length; i++) {
            if (cancelled) break;

            const assignment = finalAssignments[i];
            const progress = `${i + 1} dari ${finalAssignments.length}`;
            const accountNumber = i + 1;

            loadingText.textContent = `Mengirim pesan ${progress}`;
            progressText.textContent = `Akun ke ${accountNumber} sedang mengirim ke grub ini`;

            try {
                // Fetch media file
                const fileRes = await fetch(`/media/${encodeURIComponent(assignment.media.file)}`);
                if (!fileRes.ok) {
                    toast(`${assignment.account_id}: File tidak ditemukan: ${assignment.media.file}`, 'error');
                    continue;
                }

                const fileBlob = await fileRes.blob();

                // Determine total groups to send to
                const groupsToSend = [groupA];
                if (groupB && groupB.length > 0) {
                    groupsToSend.push(groupB);
                }
                const totalGroups = groupsToSend.length;

                // Helper function to join a group - improved with better error handling
                async function joinGroupIfNeeded(accountId, group) {
                    if (!group) return false;

                    try {
                        const accountIndex = finalAssignments.findIndex(a => a.account_id === accountId);
                        const accountNumber = accountIndex >= 0 ? accountIndex + 1 : '?';
                        progressText.textContent = `Akun ke ${accountNumber} sedang mengirim ke grub ini`;
                        const joinFd = new FormData();
                        joinFd.append('account_id', accountId);
                        joinFd.append('group', group);

                        const joinRes = await fetch(JOIN_GROUP_API, { method: 'POST', body: joinFd });
                        const joinBody = await joinRes.json();

                        if (joinRes.ok) {
                            if (!joinBody.already_member) {
                                toast(`${accountId} berhasil bergabung ke ${group}`, 'success');
                            } else {
                                // Already a member, that's fine
                                console.log(`${accountId} sudah menjadi anggota ${group}`);
                            }
                            return true;
                        } else {
                            // Check if account is dead/not found
                            const errorMsg = joinBody.detail || 'Error';
                            if (errorMsg.includes('tidak ditemukan') || errorMsg.includes('404')) {
                                toast(`${accountId}: Akun tidak ditemukan/mati, melewati akun ini`, 'error');
                                return false;
                            }
                            toast(`${accountId} gagal bergabung ke ${group}: ${errorMsg}`, 'error');
                            return false;
                        }
                    } catch (err) {
                        console.error('Error joining group:', err);
                        toast(`${accountId} error saat bergabung ke ${group}`, 'error');
                        return false;
                    }
                }

                // Helper function to send to a group - NEVER mark as posted here
                async function sendToGroup(group, isRetry = false) {
                    if (!group) return false;

                    // Buat salinan file baru untuk setiap pengiriman (penting untuk retry)
                    const fd = new FormData();
                    fd.append('account_id', assignment.account_id);
                    fd.append('group', group);
                    fd.append('message', assignment.caption);
                    fd.append('file', new File([fileBlob], assignment.media.file));
                    fd.append('random_post', 'false');
                    // NEVER mark as posted here - we'll do it after ALL groups succeed
                    fd.append('mark_posted', 'false');

                    try {
                        const res = await fetch(POST_TO_GROUP_API, { method: 'POST', body: fd });
                        const body = await res.json();

                        if (res.ok) {
                            toast(`${assignment.account_id} → ${group}: ${body.status || 'Terkirim'}`, 'success');
                            return true;
                        } else {
                            // Check if error is due to not being a member
                            const errorMsg = body.detail || 'Gagal';
                            if (errorMsg.includes('belum bergabung') || errorMsg.includes('tidak ditemukan di grup')) {
                                // Hanya coba join & retry jika ini bukan retry attempt
                                if (!isRetry) {
                                    toast(`${assignment.account_id} → ${group}: Mencoba bergabung otomatis...`, 'warning');
                                    // Try to join and retry
                                    const joined = await joinGroupIfNeeded(assignment.account_id, group);
                                    if (joined) {
                                        // Retry sending after joining (dengan FormData baru)
                                        await new Promise(resolve => setTimeout(resolve, 2000)); // Wait 2 seconds
                                        return await sendToGroup(group, true); // Recursive call dengan FormData baru
                                    } else {
                                        return false;
                                    }
                                } else {
                                    // Sudah retry, jangan coba lagi
                                    toast(`${assignment.account_id} → ${group}: ${errorMsg}`, 'error');
                                    return false;
                                }
                            } else if (errorMsg.includes('tidak ditemukan') || errorMsg.includes('404')) {
                                // Account is dead/not found
                                toast(`${assignment.account_id}: Akun tidak ditemukan/mati`, 'error');
                                return false;
                            } else {
                                toast(`${assignment.account_id} → ${group}: ${errorMsg}`, 'error');
                                return false;
                            }
                        }
                    } catch (err) {
                        console.error('Network error posting to group', group, err);
                        toast(`${assignment.account_id} → ${group}: Gagal koneksi`, 'error');
                        return false;
                    }
                }

                // Step 1: Join ALL groups FIRST before sending anything
                const accountNumber = i + 1;
                progressText.textContent = `Akun ke ${accountNumber} sedang mengirim ke grub ini`;
                let allGroupsJoined = true;
                for (const group of groupsToSend) {
                    const joined = await joinGroupIfNeeded(assignment.account_id, group);
                    if (!joined) {
                        allGroupsJoined = false;
                        toast(`${assignment.account_id}: Gagal bergabung ke ${group}, melewati akun ini`, 'error');
                        break;
                    }
                }

                if (!allGroupsJoined) {
                    // Skip this account if we couldn't join all groups
                    console.log(`Akun ${assignment.account_id} dilewati karena tidak bisa bergabung ke semua grup`);
                    continue;
                }

                // Step 2: Send to all groups (without marking as posted)
                let allSendsSuccessful = true;
                const sendResults = [];

                for (let j = 0; j < groupsToSend.length; j++) {
                    const group = groupsToSend[j];

                    if (j > 0) {
                        // Wait 3 seconds before sending to next group
                        progressText.textContent = `Akun ke ${accountNumber} sedang mengirim ke grub ini`;
                        await new Promise(resolve => setTimeout(resolve, 3000));
                    }

                    progressText.textContent = `Akun ke ${accountNumber} sedang mengirim ke grub ini`;
                    const success = await sendToGroup(group);
                    sendResults.push({ group, success });

                    if (!success) {
                        allSendsSuccessful = false;
                        // Don't break - continue trying other groups to see which ones succeed
                    }
                }

                // Step 3: Mark as posted if THIS account successfully sent to ALL groups
                // Only mark once per image (even if multiple accounts succeed)
                if (allSendsSuccessful && totalGroups > 0) {
                    // Verify all groups succeeded for this account
                    const allSucceeded = sendResults.every(r => r.success === true);

                    if (allSucceeded) {
                        // Create unique key for this image+caption combination
                        const imageKey = `${assignment.media.file}|${assignment.caption}`;

                        // Check if this image has already been marked as posted
                        if (!postedImages.has(imageKey)) {
                            // Mark as posted via API (which checks for duplicates internally)
                            try {
                                const markRes = await fetch(MARK_POSTED_API, {
                                    method: 'POST',
                                    headers: { 'Content-Type': 'application/json' },
                                    body: JSON.stringify({
                                        file: assignment.media.file,
                                        caption: assignment.caption
                                    })
                                });

                                if (markRes.ok) {
                                    // Mark as posted in our tracking map
                                    postedImages.set(imageKey, true);
                                    console.log(`Gambar ${assignment.media.file} berhasil ditandai posted setelah akun ${assignment.account_id} berhasil mengirim ke semua grup`);
                                    toast(`Gambar ${assignment.media.file} dipindahkan ke mark-posted (berhasil dikirim ke semua grup)`, 'success');
                                } else {
                                    const markBody = await markRes.json();
                                    // If already exists, mark it in our map too
                                    if (markBody.detail && markBody.detail.includes('sudah ada')) {
                                        postedImages.set(imageKey, true);
                                    }
                                    console.log(`Gambar ${assignment.media.file} mungkin sudah di mark-posted: ${markBody.detail || 'Unknown'}`);
                                }
                            } catch (err) {
                                console.error('Error marking as posted:', err);
                                toast(`Gagal menandai ${assignment.media.file} sebagai posted`, 'error');
                            }
                        } else {
                            console.log(`Gambar ${assignment.media.file} sudah ditandai posted sebelumnya, melewati`);
                        }
                    } else {
                        console.log(`Akun ${assignment.account_id}: Gambar ${assignment.media.file} tidak dipindahkan karena tidak semua grup berhasil`);
                    }
                } else {
                    console.log(`Akun ${assignment.account_id}: Gambar ${assignment.media.file} tidak dipindahkan karena tidak semua grup berhasil`);
                }

            } catch (error) {
                console.error(`Error sending for account ${assignment.account_id}:`, error);
                toast(`${assignment.account_id}: Gagal mengirim - ${error.message}`, 'error');
            }

            // Delay between sends (except for the last one)
            if (i < finalAssignments.length - 1 && !cancelled) {
                await new Promise(resolve => setTimeout(resolve, delayMs));
            }
        }

        if (cancelled) {
            toast('Pengiriman dibatalkan', 'warning');
        } else {
            // Show success message
            loadingSpinner.style.display = 'none';
            progressText.style.display = 'none';
            successMessage.style.display = 'block';
            successDetails.textContent = `${finalAssignments.length} pesan berhasil diproses ke semua grup`;
            
            // Update background text to indicate completion
            backgroundText.innerHTML = '<i class="fas fa-check-circle" style="color: var(--success);"></i> Pengiriman Selesai';
            
            // Update button visibility
            cancelBtn.style.display = 'none';
            minimizeBtn.style.display = 'none';
            closeBtn.style.display = 'block';
            
            toast('Proses pengiriman selesai', 'success');
            await loadMedia(); // Refresh media list to show posted items are gone
            // Clear captions file on server so captions won't be reused
            try {
                await fetch('/clear-captions/', { method: 'POST' });
                window.captions = null;
            } catch (err) {
                console.error('Failed to clear captions:', err);
            }
        }

    } catch (error) {
        console.error('Error in send process:', error);
        toast('Terjadi kesalahan saat mengirim pesan', 'error');
    } finally {
        // Note: Don't hide modal/indicator here - let user close it with button
        // This is different from before where it auto-closed
    }
}

// ----- SWAP FUNCTIONS -----
async function updateProfile() {
    const form = document.getElementById('swapFormName');
    const submitBtn = form?.querySelector('button[type="submit"]');
    const alert = document.getElementById('swapStatusName');

    if (!form || !submitBtn) return;

    const accountId = document.getElementById('swapAccountIdName')?.value;
    const firstName = document.getElementById('swapFirstName')?.value.trim();
    const lastName = document.getElementById('swapLastName')?.value.trim();
    const username = document.getElementById('swapUsername')?.value.trim();

    if (!accountId) {
        showAlert(alert, 'Pilih akun terlebih dahulu', 'error');
        return;
    }

    if (!firstName && !lastName && !username) {
        showAlert(alert, 'Isi minimal satu field untuk diupdate', 'error');
        return;
    }

    submitBtn.disabled = true;
    hideAlert(alert);

    try {
        let successCount = 0;

        // Update name if provided
        if (firstName || lastName) {
            const nameFormData = new FormData();
            nameFormData.append('account_id', accountId);
            nameFormData.append('new_first_name', firstName || '');
            nameFormData.append('new_last_name', lastName || '');

            const nameRes = await fetch(UPDATE_NAME_API, {
                method: 'POST',
                body: nameFormData
            });

            const nameResult = await nameRes.json();

            if (nameRes.ok) {
                successCount++;
                toast('Nama berhasil diupdate', 'success');
            } else {
                showAlert(alert, `Gagal update nama: ${nameResult.detail}`, 'error');
            }
        }

        // Update username if provided
        if (username) {
            const usernameFormData = new FormData();
            usernameFormData.append('account_id', accountId);
            usernameFormData.append('username', username);

            const usernameRes = await fetch(UPDATE_USERNAME_API, {
                method: 'POST',
                body: usernameFormData
            });

            const usernameResult = await usernameRes.json();

            if (usernameRes.ok) {
                successCount++;
                toast('Username berhasil diupdate', 'success');
            } else {
                showAlert(alert, `Gagal update username: ${usernameResult.detail}`, 'error');
            }
        }

        if (successCount > 0) {
            showAlert(alert, 'Profil berhasil diupdate', 'success');
            form.reset();
            // Mark this account as recently updated so it is highlighted in the swap list until the user refreshes
            recentlyUpdatedAccounts.add(String(accountId));
            await loadAccounts();
        }

    } catch (error) {
        console.error('Error updating profile:', error);
        showAlert(alert, 'Gagal update profil', 'error');
    } finally {
        submitBtn.disabled = false;
    }
}

async function updatePhoto() {
    const form = document.getElementById('swapFormPhoto');
    const submitBtn = form?.querySelector('button[type="submit"]');
    const alert = document.getElementById('swapStatusPhoto');

    if (!form || !submitBtn) return;

    const accountId = document.getElementById('swapAccountIdPhoto')?.value;
    const fileInput = document.getElementById('swapPhoto');
    const file = fileInput?.files[0];

    if (!accountId) {
        showAlert(alert, 'Pilih akun terlebih dahulu', 'error');
        return;
    }

    if (!file) {
        showAlert(alert, 'Pilih file foto terlebih dahulu', 'error');
        return;
    }

    if (!file.type.startsWith('image/')) {
        showAlert(alert, 'File harus berupa gambar', 'error');
        return;
    }

    submitBtn.disabled = true;
    hideAlert(alert);

    try {
        const formData = new FormData();
        formData.append('account_id', accountId);
        formData.append('photo', file);

        const res = await fetch(UPDATE_PHOTO_API, {
            method: 'POST',
            body: formData
        });

        const result = await res.json();

        if (res.ok) {
            showAlert(alert, 'Foto profil berhasil diupdate', 'success');
            toast('Foto profil berhasil diupdate', 'success');
            form.reset();
            document.getElementById('fileName').className = 'file-name-display';
            // Mark updated account so it's highlighted in swap list until refresh
            recentlyUpdatedAccounts.add(String(accountId));
            await loadAccounts();
        } else {
            showAlert(alert, result.detail || 'Gagal update foto profil', 'error');
        }

    } catch (error) {
        console.error('Error updating photo:', error);
        showAlert(alert, 'Gagal update foto profil', 'error');
    } finally {
        submitBtn.disabled = false;
    }
}

// ----- MODAL MANAGEMENT -----
function showOtpModal(accountId) {
    const modal = document.getElementById('otpModal');
    const accountIdInput = document.getElementById('otpAccountId');

    if (modal && accountIdInput) {
        accountIdInput.value = accountId;
        modal.style.display = 'block';
    }
}

function hideOtpModal() {
    const modal = document.getElementById('otpModal');
    if (modal) {
        modal.style.display = 'none';
    }
}

// ----- UTILITY FUNCTIONS -----
function shuffleArray(array) {
    const shuffled = [...array];
    for (let i = shuffled.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
    }
    return shuffled;
}

function setFormLoading(button, textElement, spinnerElement, isLoading) {
    if (button) button.disabled = isLoading;
    if (textElement) textElement.style.display = isLoading ? 'none' : 'inline';
    if (spinnerElement) spinnerElement.classList.toggle('hidden', !isLoading);
}

function showAlert(alertElement, message, type) {
    if (!alertElement) return;

    alertElement.textContent = message;
    alertElement.className = `form-alert show ${type}`;
}

function hideAlert(alertElement) {
    if (alertElement) {
        alertElement.className = 'form-alert';
    }
}

function showLoading(elementId, message) {
    const element = document.getElementById(elementId);
    if (element) {
        element.innerHTML = `<li class="list-placeholder"><i class="fas fa-spinner fa-spin"></i><span>${message}</span></li>`;
    }
}

function showError(elementId, message) {
    const element = document.getElementById(elementId);
    if (element) {
        element.innerHTML = `<li class="list-placeholder muted">${message}</li>`;
    }
}

// ----- UPLOAD HANDLERS -----
function initUploadHandlers() {
    // Attach change listeners to show selected filenames
    const mediaInput = document.getElementById('uploadMediaInput');
    const captionsInput = document.getElementById('uploadCaptionsInput');

    // Prevent duplicate initialization
    if (mediaInput && mediaInput.dataset.initialized === 'true') return;

    mediaInput?.addEventListener('change', () => {
        const status = document.getElementById('uploadMediaStatus');
        if (mediaInput.files.length) {
            status.textContent = `${mediaInput.files.length} file siap diupload`;
            status.className = 'form-alert show info';
        } else {
            status.textContent = '';
            status.className = 'form-alert';
        }
    });

    captionsInput?.addEventListener('change', () => {
        const status = document.getElementById('uploadCaptionsStatus');
        if (captionsInput.files.length) {
            status.textContent = `${captionsInput.files[0].name} siap diupload`;
            status.className = 'form-alert show info';
        } else {
            status.textContent = '';
            status.className = 'form-alert';
        }
    });
    
    if (mediaInput) mediaInput.dataset.initialized = 'true';
}

async function uploadSelectedMedia() {
    const input = document.getElementById('uploadMediaInput');
    const status = document.getElementById('uploadMediaStatus');
    if (!input || !input.files || input.files.length === 0) {
        showAlert(status, 'Pilih minimal 1 file gambar dulu', 'error');
        return;
    }

    status.textContent = 'Mengupload...';
    status.className = 'form-alert show info';

    try {
        for (let i = 0; i < input.files.length; i++) {
            const file = input.files[i];
            const fd = new FormData();
            fd.append('file', file);
            const res = await fetch('/upload-media/', { method: 'POST', body: fd });
            const result = await res.json();
            if (!res.ok) {
                showAlert(status, `Gagal upload ${file.name}: ${result.detail || 'error'}`, 'error');
                return;
            }
        }

        showAlert(status, 'Semua file berhasil diupload', 'success');
        document.getElementById('uploadMediaInput').value = '';
        await loadMedia();
    } catch (err) {
        console.error('Upload media error:', err);
        showAlert(status, 'Gagal upload file', 'error');
    }
}

async function uploadSelectedCaptions() {
    const input = document.getElementById('uploadCaptionsInput');
    const status = document.getElementById('uploadCaptionsStatus');
    if (!input || !input.files || input.files.length === 0) {
        showAlert(status, 'Pilih file captions.txt dulu', 'error');
        return;
    }

    const file = input.files[0];
    const fd = new FormData();
    fd.append('file', file);

    status.textContent = 'Mengupload captions...';
    status.className = 'form-alert show info';

    try {
        const res = await fetch('/upload-captions/', { method: 'POST', body: fd });
        const result = await res.json();
        if (res.ok) {
            showAlert(status, 'Captions berhasil diupload', 'success');
            document.getElementById('uploadCaptionsInput').value = '';
            // Reload captions for preview
            window.captions = null;
            await loadMedia();
        } else {
            showAlert(status, result.detail || 'Gagal upload captions', 'error');
        }
    } catch (err) {
        console.error('Upload captions error:', err);
        showAlert(status, 'Gagal upload captions', 'error');
    }
}

// ----- ANALYTICS MANAGEMENT -----
let currentAnalyticsData = null;
let currentGroupA = null;
let currentGroupB = null;

async function loadAnalytics(groupA = null, groupB = null) {
    try {
        currentGroupA = groupA;
        currentGroupB = groupB;

        // Show loading
        showLoading('successfulAccountsList', 'Memuat data...');
        showLoading('failedAccountsList', 'Memuat data...');
        showLoading('partialSuccessList', 'Memuat data...');
        showLoading('allAccountsDetailsList', 'Memuat data...');

        // Build URL with query parameters
        let url = ANALYTICS_API;
        const params = new URLSearchParams();
        if (groupA) params.append('group_a', groupA);
        if (groupB) params.append('group_b', groupB);
        if (params.toString()) url += '?' + params.toString();

        const res = await fetch(url);
        if (!res.ok) throw new Error('Failed to fetch analytics');

        currentAnalyticsData = await res.json();

        // Load accounts for display
        await loadAccounts();

        // Render analytics
        renderAnalytics();

    } catch (error) {
        console.error('Error loading analytics:', error);
        toast('Gagal memuat data analytics', 'error');
        showError('successfulAccountsList', 'Gagal memuat data');
        showError('failedAccountsList', 'Gagal memuat data');
        showError('partialSuccessList', 'Gagal memuat data');
        showError('allAccountsDetailsList', 'Gagal memuat data');
    }
}

function renderAnalytics() {
    if (!currentAnalyticsData) return;

    const accountData = currentAnalyticsData.accounts || {};
    const accountsMap = {};
    accounts.forEach(acc => {
        accountsMap[acc.id] = acc;
    });

    // Calculate statistics
    let successBoth = 0;
    let failedBoth = 0;
    let partialSuccess = 0;

    const successfulAccounts = [];
    const failedAccounts = [];
    const partialSuccessAccounts = [];
    const allAccountsDetails = [];

    // Process ALL accounts, not just those with analytics data
    // First, process accounts that have analytics data
    for (const [accountId, data] of Object.entries(accountData)) {
        const account = accountsMap[accountId] || { id: accountId, phone: 'N/A' };
        const groups = data.groups || {};

        // Determine status based on group A and B
        const groupA = currentGroupA || Object.keys(groups)[0];
        const groupB = currentGroupB || Object.keys(groups)[1];

        const groupAData = groups[groupA] || { success: 0, failed: 0 };
        const groupBData = groups[groupB] || { success: 0, failed: 0 };

        const hasGroupA = groupA && groups[groupA];
        const hasGroupB = groupB && groups[groupB];

        // Check if account has any success in group A
        const successA = hasGroupA && groupAData.success > 0;
        // Check if account has any success in group B
        const successB = hasGroupB && groupBData.success > 0;
        // Check if account has only failures in both groups
        const failedA = hasGroupA && groupAData.success === 0 && groupAData.failed > 0;
        const failedB = hasGroupB && groupBData.success === 0 && groupBData.failed > 0;

        const accountInfo = {
            account,
            groups,
            groupAData,
            groupBData,
            successA,
            successB,
            failedA,
            failedB
        };

        // Categorize accounts
        if (hasGroupA && hasGroupB) {
            // Both groups specified
            if (successA && successB) {
                successBoth++;
                successfulAccounts.push(accountInfo);
            } else if (failedA && failedB) {
                failedBoth++;
                failedAccounts.push(accountInfo);
            } else {
                partialSuccess++;
                partialSuccessAccounts.push(accountInfo);
            }
        } else if (hasGroupA || hasGroupB) {
            // Only one group specified
            if (successA || successB) {
                if (failedA || failedB) {
                    partialSuccess++;
                    partialSuccessAccounts.push(accountInfo);
                } else {
                    successBoth++;
                    successfulAccounts.push(accountInfo);
                }
            } else {
                failedBoth++;
                failedAccounts.push(accountInfo);
            }
        } else {
            // No specific groups, show all
            const hasAnySuccess = Object.values(groups).some(g => g.success > 0);
            const hasAnyFailure = Object.values(groups).some(g => g.failed > 0 && g.success === 0);

            if (hasAnySuccess && hasAnyFailure) {
                partialSuccess++;
                partialSuccessAccounts.push(accountInfo);
            } else if (hasAnySuccess) {
                successBoth++;
                successfulAccounts.push(accountInfo);
            } else if (hasAnyFailure) {
                failedBoth++;
                failedAccounts.push(accountInfo);
            }
        }

        allAccountsDetails.push(accountInfo);
    }

    // Now process accounts that don't have any analytics data (never sent anything)
    for (const account of accounts) {
        if (!accountData[account.id]) {
            // Account has no analytics data - it never sent anything
            const accountInfo = {
                account,
                groups: {},
                groupAData: { success: 0, failed: 0 },
                groupBData: { success: 0, failed: 0 },
                successA: false,
                successB: false,
                failedA: false,
                failedB: false
            };

            // Add to failed accounts (since they never sent anything)
            failedBoth++;
            failedAccounts.push(accountInfo);
            allAccountsDetails.push(accountInfo);
        }
    }

    // Update summary stats
    document.getElementById('totalLogs').textContent = currentAnalyticsData.total_logs || 0;
    document.getElementById('successBoth').textContent = successBoth;
    document.getElementById('failedBoth').textContent = failedBoth;

    // Render lists
    renderAccountListAnalytics('successfulAccountsList', successfulAccounts, 'success');
    renderAccountListAnalytics('failedAccountsList', failedAccounts, 'danger');
    renderAccountListAnalytics('partialSuccessList', partialSuccessAccounts, 'warning');
    renderAccountListAnalytics('allAccountsDetailsList', allAccountsDetails, 'info');
}

function renderAccountListAnalytics(elementId, accountList, type) {
    const element = document.getElementById(elementId);
    if (!element) return;

    element.innerHTML = '';

    if (accountList.length === 0) {
        element.innerHTML = '<li class="list-placeholder muted">Tidak ada data</li>';
        return;
    }

    accountList.forEach(({ account, groups, groupAData, groupBData, successA, successB, failedA, failedB }) => {
        const li = document.createElement('li');
        li.className = 'analytics-account-item';

        const groupA = currentGroupA || Object.keys(groups)[0];
        const groupB = currentGroupB || Object.keys(groups)[1];

        let statsHtml = '';

        // Show stats for each group
        if (groupA && groups[groupA]) {
            const statClass = groups[groupA].success > 0 ? 'success' : 'failed';
            statsHtml += `
                <div class="analytics-group-stat ${statClass}">
                    <div class="analytics-group-label">${groupA}</div>
                    <div class="analytics-group-value">${groups[groupA].success}✓ / ${groups[groupA].failed}✗</div>
                </div>
            `;
        } else if (groupA) {
            // Group A is specified but account has no data for it
            statsHtml += `
                <div class="analytics-group-stat failed">
                    <div class="analytics-group-label">${groupA}</div>
                    <div class="analytics-group-value">0✓ / 0✗</div>
                </div>
            `;
        }

        if (groupB && groups[groupB]) {
            const statClass = groups[groupB].success > 0 ? 'success' : 'failed';
            statsHtml += `
                <div class="analytics-group-stat ${statClass}">
                    <div class="analytics-group-label">${groupB}</div>
                    <div class="analytics-group-value">${groups[groupB].success}✓ / ${groups[groupB].failed}✗</div>
                </div>
            `;
        } else if (groupB) {
            // Group B is specified but account has no data for it
            statsHtml += `
                <div class="analytics-group-stat failed">
                    <div class="analytics-group-label">${groupB}</div>
                    <div class="analytics-group-value">0✓ / 0✗</div>
                </div>
            `;
        }

        // Show all groups if no specific filter
        if (!groupA && !groupB) {
            if (Object.keys(groups).length > 0) {
                for (const [groupName, groupData] of Object.entries(groups)) {
                    const statClass = groupData.success > 0 ? 'success' : 'failed';
                    statsHtml += `
                        <div class="analytics-group-stat ${statClass}">
                            <div class="analytics-group-label">${groupName}</div>
                            <div class="analytics-group-value">${groupData.success}✓ / ${groupData.failed}✗</div>
                        </div>
                    `;
                }
            } else {
                // Account has no data at all
                statsHtml += `
                    <div class="analytics-group-stat failed">
                        <div class="analytics-group-label">Belum ada data</div>
                        <div class="analytics-group-value">0✓ / 0✗</div>
                    </div>
                `;
            }
        }

        li.innerHTML = `
            <div class="analytics-account-info">
                <div class="analytics-account-id">${account.id}</div>
                <div class="analytics-account-phone">${account.phone || 'N/A'}</div>
            </div>
            <div class="analytics-account-stats">
                ${statsHtml}
            </div>
        `;

        element.appendChild(li);
    });
}

async function clearAnalytics() {
    if (!confirm('Apakah Anda yakin ingin menghapus semua data analytics? Tindakan ini tidak dapat dibatalkan.')) {
        return;
    }

    try {
        const res = await fetch(CLEAR_ANALYTICS_API, { method: 'POST' });
        if (!res.ok) throw new Error('Failed to clear analytics');

        toast('Data analytics berhasil dihapus', 'success');
        await loadAnalytics(currentGroupA, currentGroupB);
    } catch (error) {
        console.error('Error clearing analytics:', error);
        toast('Gagal menghapus data analytics', 'error');
    }
}

function initAnalyticsForm() {
    const form = document.getElementById('analyticsFilterForm');
    if (!form) return;
    
    // Prevent duplicate initialization
    if (form.dataset.initialized === 'true') return;

    form.addEventListener('submit', async (e) => {
        e.preventDefault();
        const groupA = document.getElementById('analyticsGroupA')?.value.trim() || null;
        const groupB = document.getElementById('analyticsGroupB')?.value.trim() || null;
        await loadAnalytics(groupA, groupB);
    });
    
    form.dataset.initialized = 'true';
}

// ----- SCHEDULE FUNCTIONS -----
async function loadSchedules() {
    try {
        const res = await fetch(SCHEDULE_API);
        if (!res.ok) throw new Error('Failed to load schedules');
        const schedules = await res.json();
        renderScheduleList(schedules);
    } catch (error) {
        console.error('Error loading schedules:', error);
    }
}

function renderScheduleList(schedules) {
    const list = document.getElementById('scheduleList');
    if (!list) return;

    if (!schedules.length) {
        list.innerHTML = '<li class="list-placeholder">Belum ada jadwal aktif</li>';
        return;
    }

    list.innerHTML = '';
    schedules.forEach(s => {
        const li = document.createElement('li');
        li.className = 'schedule-item';
        li.style.borderLeft = s.active ? '4px solid var(--success)' : '4px solid var(--gray-400)';
        li.innerHTML = `
            <div class="account-info">
                <div class="account-main"><i class="fas fa-robot"></i> ${s.time} WIB → ${s.target}</div>
                <div class="account-sub">${s.repeat === 'yes' ? 'Harian' : 'Sekali'} | Bot: ${s.bot_token.substring(0, 10)}...</div>
                <div style="font-size: 0.75rem; color: ${s.active ? 'var(--success)' : 'var(--gray-500)'}">
                    ${s.active ? '● Berjalan' : '○ Selesai'} ${s.last_run ? '| Terakhir: ' + s.last_run : ''}
                </div>
            </div>
            <button class="btn-icon" onclick="deleteSchedule('${s.id}')" style="color: var(--danger)">
                <i class="fas fa-trash"></i>
            </button>
        `;
        list.appendChild(li);
    });
}

async function loadBotSettings() {
    try {
        const res = await fetch(BOT_SETTINGS_API);
        if (res.ok) {
            const data = await res.json();
            const input = document.getElementById('schedBotToken');
            if (input && data.bot_token) {
                input.value = data.bot_token;
            }
        }
    } catch (err) {
        console.error('Gagal load bot settings:', err);
    }
}

async function saveBotSettings() {
    const token = document.getElementById('schedBotToken').value;
    if (!token) return toast('Token tidak boleh kosong', 'error');

    try {
        const res = await fetch(BOT_SETTINGS_API, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ bot_token: token })
        });
        if (res.ok) {
            toast('Bot Token berhasil disimpan permanen', 'success');
        } else {
            toast('Gagal menyimpan setelan bot', 'error');
        }
    } catch (err) {
        toast('Koneksi ke server bermasalah', 'error');
    }
}

async function testBotMessage() {
    const btn = document.getElementById('testBotMsgBtn');
    const target = document.getElementById('schedTarget').value;
    const botToken = document.getElementById('schedBotToken').value;
    const caption = document.getElementById('schedCaption').value;

    if (!target || !botToken || !caption) {
        return toast('Target, Token, dan Caption wajib diisi untuk test!', 'warning');
    }

    btn.disabled = true;
    btn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Testing...';

    const fd = new FormData();
    fd.append('target', target);
    fd.append('bot_token', botToken);
    fd.append('caption', caption);
    fd.append('buttons', getButtonsData());

    const fileInput = document.getElementById('schedImageFile');
    if (fileInput.files[0]) {
        fd.append('image', fileInput.files[0]);
    }

    try {
        const res = await fetch(TEST_BOT_API, { method: 'POST', body: fd });
        const data = await res.json();
        if (res.ok) {
            toast(data.status, 'success');
        } else {
            toast(data.detail || 'Test gagal terkirim', 'error');
        }
    } catch (err) {
        toast('Koneksi terputus saat testing', 'error');
    } finally {
        btn.disabled = false;
        btn.innerHTML = '<i class="fas fa-paper-plane"></i> Test Kirim';
    }
}

// ----- SCHEDULE FORM BUTTONS MANAGEMENT -----
function initButtonsContainer() {
    const container = document.getElementById('buttonsContainer');
    if (!container) return;
    
    // Clear existing
    container.innerHTML = '';
    
    // Add one default button input
    addButtonInput();
}

function addButtonInput() {
    const container = document.getElementById('buttonsContainer');
    if (!container) return;
    
    const buttonDiv = document.createElement('div');
    buttonDiv.className = 'button-input-row';
    buttonDiv.style.display = 'flex';
    buttonDiv.style.gap = '10px';
    buttonDiv.style.marginBottom = '10px';
    buttonDiv.style.alignItems = 'center';
    
    buttonDiv.innerHTML = `
        <input type="text" class="form-input button-title" placeholder="Judul Tombol" style="flex: 1; background: var(--white);">
        <input type="url" class="form-input button-url" placeholder="https://example.com" style="flex: 1; background: var(--white);">
        <button type="button" class="btn btn-outline btn-sm remove-button" style="flex-shrink: 0;">
            <i class="fas fa-trash"></i>
        </button>
    `;
    
    container.appendChild(buttonDiv);
    
    // Add event listener to remove button
    buttonDiv.querySelector('.remove-button').addEventListener('click', () => {
        buttonDiv.remove();
    });
}

function getButtonsData() {
    const container = document.getElementById('buttonsContainer');
    if (!container) return '';
    
    const buttons = [];
    container.querySelectorAll('.button-input-row').forEach(row => {
        const title = row.querySelector('.button-title').value.trim();
        const url = row.querySelector('.button-url').value.trim();
        if (title && url) {
            buttons.push(`${title} | ${url}`);
        }
    });
    
    return buttons.join('\n');
}

function initScheduleForm() {
    const form = document.getElementById('scheduleForm');
    if (!form || form.dataset.init === 'true') return;

    // Initialize buttons container
    initButtonsContainer();

    // Manual Buttons
    document.getElementById('saveBotTokenBtn')?.addEventListener('click', saveBotSettings);
    document.getElementById('testBotMsgBtn')?.addEventListener('click', testBotMessage);
    document.getElementById('addButtonBtn')?.addEventListener('click', addButtonInput);

    form.addEventListener('submit', async (e) => {
        e.preventDefault();

        // Cek waktu hanya jika mau save jadwal
        const timeVal = document.getElementById('schedTime').value;
        if (!timeVal) {
            return toast('Waktu kirim wajib diisi untuk mengaktifkan jadwal!', 'warning');
        }

        const btn = form.querySelector('button[type="submit"]');
        btn.disabled = true;
        btn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Sedang Memproses...';

        const fd = new FormData();
        fd.append('target', document.getElementById('schedTarget').value);
        fd.append('time', document.getElementById('schedTime').value);
        fd.append('repeat', document.getElementById('schedRepeat').value);
        fd.append('caption', document.getElementById('schedCaption').value);
        fd.append('bot_token', document.getElementById('schedBotToken').value);
        fd.append('buttons', getButtonsData());

        const fileInput = document.getElementById('schedImageFile');
        if (fileInput.files[0]) {
            fd.append('image', fileInput.files[0]);
        }

        try {
            const res = await fetch(SCHEDULE_API, { method: 'POST', body: fd });
            if (res.ok) {
                toast('Jadwal Bot berhasil diaktifkan!', 'success');
                form.reset();
                initButtonsContainer(); // Reset buttons to default
                loadSchedules();
                updateDashboardStats();
            } else {
                const data = await res.json();
                toast('Error: ' + (data.detail || 'Gagal menyimpan'), 'error');
            }
        } catch (err) {
            toast('Koneksi bermasalah', 'error');
        } finally {
            btn.disabled = false;
            btn.innerHTML = '<i class="fas fa-save"></i> Aktifkan Jadwal Bot';
        }
    });

    form.dataset.init = 'true';
}

async function deleteSchedule(id) {
    if (!confirm('Hapus jadwal ini?')) return;
    try {
        const res = await fetch(`${SCHEDULE_API}${id}`, { method: 'DELETE' });
        if (res.ok) {
            toast('Jadwal dihapus', 'info');
            loadSchedules();
            updateDashboardStats();
        }
    } catch (err) {
        toast('Gagal menghapus', 'error');
    }
}

// ----- EVENT LISTENERS -----
function initEventListeners() {
    // Refresh buttons
    const refreshAccountsBtn = document.getElementById('refreshAccountsBtn');
    const refreshMediaBtn = document.getElementById('refreshMediaBtn');
    const refreshAnalyticsBtn = document.getElementById('refreshAnalyticsBtn');

    refreshAccountsBtn?.addEventListener('click', () => {
        // User-triggered refresh clears the temporary 'recently updated' markers
        recentlyUpdatedAccounts.clear();
        loadAccounts();
    });
    refreshMediaBtn?.addEventListener('click', () => loadMedia());
    refreshAnalyticsBtn?.addEventListener('click', () => loadAnalytics(currentGroupA, currentGroupB));

    // Clear analytics button
    const clearAnalyticsBtn = document.getElementById('clearAnalyticsBtn');
    clearAnalyticsBtn?.addEventListener('click', clearAnalytics);

    // Upload buttons
    document.getElementById('uploadMediaBtn')?.addEventListener('click', uploadSelectedMedia);
    document.getElementById('uploadCaptionsBtn')?.addEventListener('click', uploadSelectedCaptions);

    // Modal close
    const closeOtpModal = document.getElementById('closeOtpModal');
    closeOtpModal?.addEventListener('click', hideOtpModal);

    // Close modal when clicking outside
    const otpModal = document.getElementById('otpModal');
    otpModal?.addEventListener('click', (e) => {
        if (e.target === otpModal) {
            hideOtpModal();
        }
    });
}

// ----- INITIALIZATION -----
document.addEventListener('DOMContentLoaded', function () {
    console.log('Initializing Telegram Multi-Account Panel...');

    // Initialize all components
    initTheme();
    initTabs();
    initForms();
    initEventListeners();

    // Load initial data
    loadAccounts();
    loadMedia();

    console.log('Telegram Multi-Account Panel initialized successfully');
});

// Error handling
window.addEventListener('error', function (e) {
    console.error('Global error:', e.error);
});

window.addEventListener('unhandledrejection', function (e) {
    console.error('Unhandled promise rejection:', e.reason);
});