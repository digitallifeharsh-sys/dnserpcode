// Sidebar Toggle
const sidebar = document.getElementById('sidebar');
const sidebarToggle = document.getElementById('sidebarToggle');
const sidebarClose = document.getElementById('sidebarClose');
const sidebarOverlay = document.getElementById('sidebarOverlay');

const openSidebar = () => {
    sidebar?.classList.add('show');
    sidebarOverlay?.classList.add('show');
};

const closeSidebar = () => {
    sidebar?.classList.remove('show');
    sidebarOverlay?.classList.remove('show');
};

sidebarToggle?.addEventListener('click', () => {
    if (sidebar?.classList.contains('show')) {
        closeSidebar();
    } else {
        openSidebar();
    }
});

sidebarClose?.addEventListener('click', closeSidebar);
sidebarOverlay?.addEventListener('click', closeSidebar);

// Mobile navigation accessibility and scroll handling.
const syncMobileMenuState = () => {
    const isOpen = sidebar?.classList.contains('show');
    document.body.classList.toggle('sidebar-open', Boolean(isOpen));
    sidebarToggle?.setAttribute('aria-expanded', isOpen ? 'true' : 'false');
};

const originalOpenSidebar = openSidebar;
const originalCloseSidebar = closeSidebar;

// Keep the existing sidebar behaviour and add keyboard/link close support.
sidebarToggle?.addEventListener('click', syncMobileMenuState);
sidebarClose?.addEventListener('click', syncMobileMenuState);
sidebarOverlay?.addEventListener('click', syncMobileMenuState);

document.addEventListener('keydown', (event) => {
    if (event.key === 'Escape' && sidebar?.classList.contains('show')) {
        originalCloseSidebar();
        syncMobileMenuState();
    }
});

sidebar?.querySelectorAll('a.sidebar-link').forEach((link) => {
    link.addEventListener('click', () => {
        if (window.matchMedia('(max-width: 991.98px)').matches) {
            originalCloseSidebar();
            syncMobileMenuState();
        }
    });
});
